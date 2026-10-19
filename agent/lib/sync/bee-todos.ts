// Queued tips become Bee todos (FR-17), at most 10 open at once (FR-20). drainTodoQueue is a status-driven RECONCILER
// (BINDING, progress.md M3-T2a): run by the bee-changes schedule and nudged by the "bee-todos" status effect, it makes
// Bee match Postgres and is safe to re-run or crash at any point:
//   1. tips that left "queued" with a todo: complete it (tried/thanked) or delete it (anything else); 404 = gone.
//   1b. queued tips with an open todo: Tarik's edit of its text in Bee fixes the tip; a fix from anywhere refreshes it.
//   2. queued tips with no todo: re-link or reopen the tip's own todo, adopt an unsaved twin with the same text (a crash
//      between create and save), or create one, while Bee's real count of open Earmark todos is under 10.
// createEarmarkTodo is the same machinery for M5's other todos (place nudges, receipts). Decision 014.
// Bee first, then Postgres: sync state is saved only after Bee succeeded. Kill switch: writes only when
// BEE_TODO_WRITES=on. Logs carry ids and err.name only; todo text never holds transcript text (todo-text.ts).
import { randomUUID } from "node:crypto";
import type { generateText } from "ai";
import { BeeApiError, createBeeClient, type BeeClient, type Todo } from "../bee/client";
import { db } from "../db";
import type { TipFix, TipNow } from "../recs/fix-tip";
import type { StatusChange } from "../recs/status-effects";
import { CLAIM_LEASE } from "../store/conversations";
import { readTodoEdit, todoEditAction } from "./todo-edit";
import { formatTodoText, MAX_OPEN_TODOS, TODO_PREFIX } from "./todo-text";

export const MAX_WRITES_PER_RUN = 10;
const LIST_PAGE = 100;
const MAX_LIST_PAGES = 10; // 1 000 todos; a longer list is "incomplete" and no todo is created (the cap can't be counted)
const BEE_TODOS_LEASE = "bee_todos_lease"; // sync_cursors row, the rec lane's lease pattern (lane.ts)
const DEFAULT_BASE_URL = "https://earmark-two.vercel.app";

type TodoBee = Pick<BeeClient, "listTodos" | "createTodo" | "updateTodo" | "deleteTodo" | "getTodo">;
export interface DrainDeps {
  bee: TodoBee;
  env: Record<string, string | undefined>;
  onlyIds: number[] | null; // integration tests: never touch other rows
  /** Backstop (M3-T8): the inbound rec handler, passed by the bee-changes schedule (todo-handlers.ts imports this file). */
  checkLinked?: (recId: number, todo: Todo | null) => Promise<void>;
  lease?: string; // integration tests: their own lease name (shared TEST branch)
  generate?: typeof generateText; // the model call that reads a free rewrite (todo-edit.ts); tests pass a stub
}
export interface DrainCounts {
  created: number; adopted: number; completed: number; removed: number; open: number; fixed: number; refreshed: number; failed: boolean;
}
export type DrainResult = { status: "skipped" } | { status: "locked" } | ({ status: "done" } & DrainCounts);
export type EarmarkTodoResult = { todoId: number } | { skipped: "cap" | "off" | "locked" };

// Loaded when used, not imported: fix-tip → lane → garden → status → status-effects → this file is a cycle.
const fixTip = () => import("../recs/fix-tip");
const errName = (err: unknown) => (err instanceof Error ? err.name : "unknown");

function writesOn(env: Record<string, string | undefined>): boolean {
  if (env.BEE_TODO_WRITES === "on") return true;
  console.log("[bee-todos] skipped: BEE_TODO_WRITES off");
  return false;
}

// One Bee todo writer at a time (schedule, status nudges, M5, inbound changes in todo-handlers.ts), else two could each
// create the same todo or one could undo the other's link. `name`: integration tests use their own (shared TEST branch).
export async function withLease<T>(work: () => Promise<T>, name = BEE_TODOS_LEASE): Promise<T | "locked"> {
  const token = randomUUID();
  const took = await db()`
    insert into sync_cursors (name, cursor) values (${name}, ${token})
    on conflict (name) do update set cursor = excluded.cursor, updated_at = now()
      where sync_cursors.updated_at < now() - ${CLAIM_LEASE}::interval
    returning cursor`;
  if (took.length === 0) return "locked";
  try {
    return await work();
  } finally {
    await db()`delete from sync_cursors where name = ${name} and cursor = ${token}`;
  }
}

interface BeeView {
  inBee: Map<number, Todo>;
  complete: boolean; // false = the list was cut off: the cap can't be counted, so nothing is created
  claimed: Set<number>; // every Bee todo id Earmark has recorded (any entity type)
  isOpen: (t: Todo | undefined) => boolean;
  open: Todo[];
}

// Bee's real list is the cap's truth. An open todo is ours if it has the prefix OR Earmark recorded its id (Tarik may
// have edited the text in Bee); his own todos never count. A list failure throws: no writes without the real count.
async function readBee(bee: TodoBee): Promise<BeeView> {
  const todos: Todo[] = [];
  let cursor: string | undefined;
  let complete = false;
  for (let page = 0; page < MAX_LIST_PAGES && !complete; page++) {
    const res = await bee.listTodos({ limit: LIST_PAGE, cursor });
    todos.push(...res.todos);
    complete = !res.next_cursor;
    cursor = res.next_cursor ?? undefined;
  }
  const claimed = new Set((await db()`
    select bee_id from bee_sync where bee_object = 'todo'
    union select bee_todo_id from recommendations where bee_todo_id is not null`).map((x) => Number(x.bee_id)));
  const isOpen = (t: Todo | undefined) => !!t && !t.completed && (t.text.startsWith(TODO_PREFIX) || claimed.has(t.id));
  return { inBee: new Map(todos.map((t) => [t.id, t])), complete, claimed, isOpen, open: todos.filter(isOpen) };
}

export async function drainTodoQueue(deps: Partial<DrainDeps> = {}): Promise<DrainResult> {
  const env = deps.env ?? process.env;
  if (!writesOn(env)) return { status: "skipped" };
  const d: DrainDeps = {
    bee: deps.bee ?? createBeeClient(), env, onlyIds: deps.onlyIds ?? null, checkLinked: deps.checkLinked, generate: deps.generate,
  };
  const out = await withLease(() => reconcile(d), deps.lease);
  return out === "locked" ? { status: "locked" } : { status: "done", ...out };
}

/**
 * The "bee-todos" status effect: a tip entering or leaving "queued" runs the reconciler now, not at the next tick.
 * A garden tap never waits on it: the server actions pass setRecStatus a `defer` (after()). No next/* import here:
 * eve evaluates this module outside Next. A failure is only logged: the scheduled reconciler is the guarantee.
 */
export async function beeTodoEffect(c: StatusChange, drain: () => Promise<unknown> = drainTodoQueue): Promise<void> {
  if (c.previous !== "queued" && c.next !== "queued") return;
  await drain().catch((err: unknown) => console.error(`[bee-todos] nudge failed error=${errName(err)}`));
}

async function reconcile(d: DrainDeps): Promise<DrainCounts> {
  const view = await readBee(d.bee);
  const r: DrainCounts = { created: 0, adopted: 0, completed: 0, removed: 0, open: view.open.length, fixed: 0, refreshed: 0, failed: false };
  let writes = 0;

  // One Bee write. 404 = already gone. Any other error stops the run (Bee is unwell; the next tick retries).
  async function write<T>(op: string, recId: number, fn: () => Promise<T>): Promise<T | "gone" | "failed"> {
    writes++;
    try {
      return await fn();
    } catch (err) {
      if (err instanceof BeeApiError && err.status === 404) return "gone";
      console.error(`[bee-todos] ${op} failed rec=${recId} error=${errName(err)}`);
      r.failed = true;
      return "failed";
    }
  }

  // 0. Backstop (M3-T8, scheduled run only): a queued tip whose todo is not open in Bee was completed or deleted there
  // and the change never landed (stream is at-most-once; a todo change is dropped after 5 failed tries). Bee's list or
  // one GET (a read, but it takes a slot of the per-run cap) gives the todo; the inbound rec handler applies it:
  // completed → tried, 404 → back to 'new' (decision 016). Queued linked tips number about the 10-open cap: no limit.
  if (d.checkLinked) {
    const linked = await db()`
      select id, bee_todo_id from recommendations
      where status = 'queued' and bee_todo_id is not null
        and (${d.onlyIds}::bigint[] is null or id = any(${d.onlyIds}::bigint[]))
      order by updated_at, id`;
    for (const row of linked) {
      const recId = Number(row.id);
      const beeId = Number(row.bee_todo_id);
      const listed = view.inBee.get(beeId);
      if (listed && !listed.completed) continue;
      if (!listed && writes >= MAX_WRITES_PER_RUN) return r;
      const got = listed ?? (await write("check", recId, () => d.bee.getTodo(beeId)));
      if (got === "failed") return r;
      await d.checkLinked(recId, got === "gone" ? null : got);
    }
  }

  // 1. Tips that left "queued" but still hold a todo.
  const leaving = await db()`
    select id, status, bee_todo_id from recommendations
    where bee_todo_id is not null and status <> 'queued'
      and (${d.onlyIds}::bigint[] is null or id = any(${d.onlyIds}::bigint[]))
    order by updated_at, id limit ${MAX_WRITES_PER_RUN}`;
  for (const row of leaving) {
    if (writes >= MAX_WRITES_PER_RUN) return r;
    const recId = Number(row.id);
    const beeId = Number(row.bee_todo_id);
    const done = row.status === "tried" || row.status === "thanked";
    const t = view.inBee.get(beeId);
    // Bee's full list is the truth: no call for a todo already gone, or already completed when completing.
    let out: unknown = view.complete && !t ? "gone" : "ok";
    if (out === "ok" && !(done && t?.completed)) {
      out = await write(done ? "complete" : "remove", recId, () =>
        done ? d.bee.updateTodo(beeId, { completed: true }) : d.bee.deleteTodo(beeId));
    }
    if (out === "failed") return r;
    const kept = done && out !== "gone";
    await saveLeft(recId, beeId, kept);
    if (kept) r.completed++;
    else r.removed++;
    if (view.isOpen(t)) r.open--;
  }

  // 1b. Queued tips with an open todo (decision 049). Tarik's edit of its text in Bee is a fix: read the new words
  // (todo-edit.ts), write the tip's clean text to Bee, then applyTipFix (the tip is looked up again). Bee first: a Bee
  // failure or a crash leaves the edit to be read again next run, and applyTipFix's compare-and-set applies it once.
  // An edit that is no fix is marked seen and left alone in Bee. A todo he hasn't edited gets the tip's new text after
  // any fix (the tip page, or the lane's own name for the corrected words).
  const base = d.env.EARMARK_PUBLIC_BASE_URL || DEFAULT_BASE_URL;
  const linked = await db()`
    select r.id, r.type, r.canonical_name, r.creator, r.context_summary, p.first_name as recommender_first_name, r.said_at,
      r.bee_todo_id, s.last_written_state
    from recommendations r
    join bee_sync s on s.entity_type = 'rec' and s.entity_id = r.id and s.bee_object = 'todo' and s.bee_id = r.bee_todo_id
    left join recommenders p on p.id = r.recommender_id
    where r.status = 'queued'
      and (${d.onlyIds}::bigint[] is null or r.id = any(${d.onlyIds}::bigint[]))
    order by r.updated_at, r.id`;
  for (const row of linked) {
    if (writes >= MAX_WRITES_PER_RUN) break;
    const recId = Number(row.id);
    const beeId = Number(row.bee_todo_id);
    const t = view.inBee.get(beeId);
    if (!t || t.completed) continue; // step 0 and the inbound handler's
    const tip = { ...row, id: recId } as Parameters<typeof formatTodoText>[0] & TipNow;
    let text = formatTodoText(tip, base);
    const action = todoEditAction(row.last_written_state, t.text, text);
    if (action === "none") continue;
    if (action === "adopt") {
      await saveTodoState(recId, beeId, { text });
      continue;
    }
    let fix: TipFix | null = null;
    if (action === "fix") {
      const { planTipFix, TipFixSchema } = await fixTip();
      const read = await readTodoEdit(row.last_written_state.text, t.text, tip, d.generate).catch((err: unknown) => {
        console.error(`[bee-todos] read edit failed rec=${recId} error=${errName(err)}`);
        return null;
      });
      const valid = read ? TipFixSchema.safeParse(read) : null;
      const plan = valid?.success ? planTipFix(tip, valid.data) : null;
      if (!valid?.success || !plan?.relook) {
        await saveTodoState(recId, beeId, { seen: t.text });
        continue;
      }
      fix = valid.data;
      text = formatTodoText({ ...tip, type: plan.type, canonical_name: plan.name, creator: plan.creator }, base);
    }
    if (t.text !== text) {
      const out = await write(fix ? "fix" : "refresh", recId, () => d.bee.updateTodo(beeId, { text }));
      if (out === "failed") return r;
      if (out === "gone") continue;
    }
    if (fix) {
      await (await fixTip()).applyTipFix(recId, fix)
        .catch((err: unknown) => console.error(`[bee-todos] fix failed id=${recId} err=${errName(err)}`));
    }
    await saveTodoState(recId, beeId, { text });
    if (fix) r.fixed++;
    else r.refreshed++;
  }

  // 2. Queued tips with no todo, oldest first, while there is room.
  if (!view.complete) {
    console.error("[bee-todos] Bee todo list incomplete; no todo created this run");
    return r;
  }
  const queued = await db()`
    select r.id, r.type, r.canonical_name, r.creator, p.first_name as recommender_first_name, r.said_at, s.bee_id as old_id
    from recommendations r
    left join recommenders p on p.id = r.recommender_id
    left join bee_sync s on s.entity_type = 'rec' and s.entity_id = r.id and s.bee_object = 'todo'
    where r.status = 'queued' and r.bee_todo_id is null
      and (${d.onlyIds}::bigint[] is null or r.id = any(${d.onlyIds}::bigint[]))
    order by r.updated_at, r.id limit ${MAX_OPEN_TODOS}`;

  for (const row of queued) {
    // Two writes of headroom: the write itself plus the undo, so a todo is never left orphaned by the per-run cap.
    if (writes + 2 > MAX_WRITES_PER_RUN) return r;
    const recId = Number(row.id);
    const text = formatTodoText({ ...row, id: recId } as Parameters<typeof formatTodoText>[0], base);
    const old = row.old_id == null ? undefined : view.inBee.get(Number(row.old_id));
    const twin = old ? undefined : view.open.find((t) => t.text === text && !view.claimed.has(t.id));
    // Already-open todos (its own, or a crash's twin) are counted in `open`; a reopen or create takes a slot.
    const takesSlot = old ? old.completed : !twin;
    if (takesSlot && r.open >= MAX_OPEN_TODOS) return r;
    let beeId: number;
    if (old) {
      // Its own todo: reopen it if it was completed (re-queued after it was tried), refresh text if it changed.
      if (old.completed || old.text !== text) {
        const out = await write("reopen", recId, () => d.bee.updateTodo(old.id, { text, completed: false }));
        if (out === "failed") return r;
        if (out === "gone") continue; // deleted in Bee meanwhile: next run creates a new one
      }
      beeId = old.id;
    } else if (twin) {
      beeId = twin.id; // made by a run that crashed before saving: adopt, don't duplicate
    } else {
      const out = await write("create", recId, () => d.bee.createTodo({ text }));
      if (out === "failed" || out === "gone") return r;
      beeId = out.id;
    }
    if (!(await saveTodo("rec", recId, beeId, text, true))) {
      // The tip left "queued" (or was forgotten) while Bee worked: take the todo back out, don't orphan it.
      if ((await write("undo", recId, () => d.bee.deleteTodo(beeId))) === "failed") return r;
      continue;
    }
    view.claimed.add(beeId);
    if (takesSlot) {
      r.created++;
      r.open++;
    } else r.adopted++;
  }
  return r;
}

/**
 * One Earmark todo for an entity other than a tip (M5-T5 place nudges, M5-T6 receipts): same kill switch, lease and
 * Bee-counted 10-open cap as the reconciler, "Earmark · " prefix added if missing, bee_sync stored under `entityType`.
 * Idempotent: a retry returns the entity's todo while it is open in Bee, or adopts an unsaved same-text twin.
 * Any `{ skipped }` means no todo was made ("locked": another Bee todo writer is running, retry later). A Bee error
 * throws to the caller. Forget: bee_sync rows of types other than 'rec'/'idea' are deleted by their owner's
 * FORGET_HOOKS (lane C), not by forget-rows.ts.
 */
export async function createEarmarkTodo(
  input: { entityType: string; entityId: number; text: string; alarmAt: string | null },
  deps: Partial<Pick<DrainDeps, "bee" | "env">> = {},
): Promise<EarmarkTodoResult> {
  const { entityType, entityId } = input;
  if (!/^[a-z_]+$/.test(entityType) || entityType === "rec" || !Number.isSafeInteger(entityId) || entityId <= 0) {
    throw new Error("invalid Earmark todo target"); // tips' todos belong to the reconciler
  }
  if (!writesOn(deps.env ?? process.env)) return { skipped: "off" };
  const bee = deps.bee ?? createBeeClient();
  const text = input.text.startsWith(TODO_PREFIX) ? input.text : `${TODO_PREFIX}${input.text}`;
  const out = await withLease(async (): Promise<EarmarkTodoResult> => {
    const view = await readBee(bee);
    const [mine] = await db()`
      select bee_id from bee_sync where entity_type = ${entityType} and entity_id = ${entityId} and bee_object = 'todo'`;
    const existing = mine ? view.inBee.get(Number(mine.bee_id)) : undefined;
    if (existing && !existing.completed) return { todoId: existing.id };
    const twin = view.open.find((t) => t.text === text && !view.claimed.has(t.id));
    let todoId: number;
    if (twin) todoId = twin.id;
    else if (!view.complete || view.open.length >= MAX_OPEN_TODOS) {
      console.log(`[bee-todos] cap: ${entityType} ${entityId} not created`);
      return { skipped: "cap" };
    } else todoId = (await bee.createTodo({ text, alarmAt: input.alarmAt })).id;
    await saveTodo(entityType, entityId, todoId, text, false);
    return { todoId };
  });
  return out === "locked" ? { skipped: "locked" } : out;
}

// Upsert the entity's bee_sync row. For a tip (onlyQueuedRec) it is one statement with the guarded rec update: saved
// only while the tip is still queued without a todo, so the rec and bee_sync never disagree.
export async function saveTodo(entityType: string, entityId: number, beeId: number, text: string, onlyQueuedRec: boolean): Promise<boolean> {
  const state = JSON.stringify({ text, completed: false });
  const rows = onlyQueuedRec
    ? await db()`
      with r as (
        update recommendations set bee_todo_id = ${beeId}
        where id = ${entityId} and status = 'queued' and bee_todo_id is null returning id)
      insert into bee_sync (entity_type, entity_id, bee_object, bee_id, last_written_state, last_synced_at)
      select ${entityType}, id, 'todo', ${beeId}, ${state}::jsonb, now() from r
      on conflict (entity_type, entity_id, bee_object)
      do update set bee_id = excluded.bee_id, last_written_state = excluded.last_written_state, last_synced_at = now()
      returning entity_id`
    : await db()`
      insert into bee_sync (entity_type, entity_id, bee_object, bee_id, last_written_state, last_synced_at)
      values (${entityType}, ${entityId}, 'todo', ${beeId}, ${state}::jsonb, now())
      on conflict (entity_type, entity_id, bee_object)
      do update set bee_id = excluded.bee_id, last_written_state = excluded.last_written_state, last_synced_at = now()
      returning entity_id`;
  return rows.length > 0;
}

// A tip's open todo: the text Earmark wrote to Bee, or an edit of Tarik's read and left alone (seen), saved while the
// tip still holds that todo. A new text drops any seen edit: Bee no longer shows it.
async function saveTodoState(recId: number, beeId: number, patch: { text: string } | { seen: string }): Promise<void> {
  await db()`
    update bee_sync set last_synced_at = now(),
      last_written_state = (coalesce(last_written_state, '{}'::jsonb) - 'seen') || ${JSON.stringify(patch)}::jsonb
    where entity_type = 'rec' and entity_id = ${recId} and bee_object = 'todo' and bee_id = ${beeId}`;
}

// kept = Bee still holds the todo, completed: its bee_sync row stays (forget deletes it from Bee; a re-queue reopens
// it). Otherwise the todo is gone and so is the row. Either way the tip no longer has an open todo.
export async function saveLeft(recId: number, beeId: number, kept: boolean): Promise<void> {
  if (kept) {
    await db()`
      with r as (update recommendations set bee_todo_id = null where id = ${recId} and bee_todo_id = ${beeId} returning id)
      insert into bee_sync (entity_type, entity_id, bee_object, bee_id, last_written_state, last_synced_at)
      select 'rec', id, 'todo', ${beeId}, '{"completed": true}'::jsonb, now() from r
      on conflict (entity_type, entity_id, bee_object)
      do update set bee_id = excluded.bee_id, last_synced_at = now(),
        last_written_state = coalesce(bee_sync.last_written_state, '{}'::jsonb) || '{"completed": true}'::jsonb`;
  } else {
    await db()`
      with r as (update recommendations set bee_todo_id = null where id = ${recId} and bee_todo_id = ${beeId})
      delete from bee_sync where bee_object = 'todo' and bee_id = ${beeId}`;
  }
}
