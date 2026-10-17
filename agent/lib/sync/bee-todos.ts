// Queued tips become Bee todos (FR-17), at most 10 open at once (FR-20). drainTodoQueue is a status-driven RECONCILER
// (BINDING, progress.md M3-T2a): run by the bee-changes schedule and nudged by the "bee-todos" status effect, it makes
// Bee match Postgres and is safe to re-run or crash at any point:
//   1. tips that left "queued" with a todo: complete it (tried/thanked) or delete it (anything else); 404 = gone.
//   2. queued tips with no todo: reopen the tip's own completed todo, adopt an unsaved twin with the same text (a crash
//      between create and save), or create one, while Bee's real count of open "Earmark · " todos is under 10.
// Bee first, then Postgres: sync state is saved only after Bee succeeded. Kill switch: writes only when
// BEE_TODO_WRITES=on. Logs carry ids and err.name only; todo text never holds transcript text (todo-text.ts).
import { randomUUID } from "node:crypto";
import { BeeApiError, createBeeClient, type BeeClient, type Todo } from "../bee/client";
import { db } from "../db";
import type { StatusChange } from "../recs/status-effects";
import { CLAIM_LEASE } from "../store/conversations";
import { formatTodoText, MAX_OPEN_TODOS, TODO_PREFIX } from "./todo-text";

export const MAX_WRITES_PER_RUN = 10;
const LIST_PAGE = 100;
const MAX_LIST_PAGES = 10; // 1 000 todos; a longer list is "incomplete" and no todo is created (the cap can't be counted)
const BEE_TODOS_LEASE = "bee_todos_lease"; // sync_cursors row, the rec lane's lease pattern (lane.ts)
const DEFAULT_BASE_URL = "https://earmark-two.vercel.app";

type TodoBee = Pick<BeeClient, "listTodos" | "createTodo" | "updateTodo" | "deleteTodo">;
export interface DrainDeps {
  bee: TodoBee;
  env: Record<string, string | undefined>;
  onlyIds: number[] | null; // integration tests: never touch other rows
}
export interface DrainCounts { created: number; adopted: number; completed: number; removed: number; open: number; failed: boolean }
export type DrainResult = { status: "skipped" } | { status: "locked" } | ({ status: "done" } & DrainCounts);

export async function drainTodoQueue(deps: Partial<DrainDeps> = {}): Promise<DrainResult> {
  const env = deps.env ?? process.env;
  if (env.BEE_TODO_WRITES !== "on") {
    console.log("[bee-todos] skipped: BEE_TODO_WRITES off");
    return { status: "skipped" };
  }
  const d: DrainDeps = { bee: deps.bee ?? createBeeClient(), env, onlyIds: deps.onlyIds ?? null };
  // One reconciler at a time (schedule + status nudges), else two runs could each create the same tip's todo.
  const token = randomUUID();
  const took = await db()`
    insert into sync_cursors (name, cursor) values (${BEE_TODOS_LEASE}, ${token})
    on conflict (name) do update set cursor = excluded.cursor, updated_at = now()
      where sync_cursors.updated_at < now() - ${CLAIM_LEASE}::interval
    returning cursor`;
  if (took.length === 0) return { status: "locked" };
  try {
    return { status: "done", ...(await reconcile(d)) };
  } finally {
    await db()`delete from sync_cursors where name = ${BEE_TODOS_LEASE} and cursor = ${token}`;
  }
}

/** The "bee-todos" status effect: a tip entering or leaving "queued" runs the reconciler now, not at the next tick. */
export async function beeTodoEffect(c: StatusChange, drain: () => Promise<unknown> = drainTodoQueue): Promise<void> {
  if (c.previous === "queued" || c.next === "queued") await drain();
}

async function listAll(bee: TodoBee): Promise<{ todos: Todo[]; complete: boolean }> {
  const todos: Todo[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const res = await bee.listTodos({ limit: LIST_PAGE, cursor });
    todos.push(...res.todos);
    if (!res.next_cursor) return { todos, complete: true };
    cursor = res.next_cursor;
  }
  return { todos, complete: false };
}

const errName = (err: unknown) => (err instanceof Error ? err.name : "unknown");

async function reconcile(d: DrainDeps): Promise<DrainCounts> {
  const { todos, complete } = await listAll(d.bee); // a list failure throws: no writes without the real count
  const inBee = new Map(todos.map((t) => [t.id, t]));
  const isOpenEarmark = (t: Todo | undefined) => !!t && !t.completed && t.text.startsWith(TODO_PREFIX);
  const openEarmark = todos.filter(isOpenEarmark);
  const r: DrainCounts = { created: 0, adopted: 0, completed: 0, removed: 0, open: openEarmark.length, failed: false };
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
    const t = inBee.get(beeId);
    // Bee's full list is the truth: no call for a todo already gone, or already completed when completing.
    let out: unknown = complete && !t ? "gone" : "ok";
    if (out === "ok" && !(done && t?.completed)) {
      out = await write(done ? "complete" : "remove", recId, () =>
        done ? d.bee.updateTodo(beeId, { completed: true }) : d.bee.deleteTodo(beeId));
    }
    if (out === "failed") return r;
    const kept = done && out !== "gone";
    await saveLeft(recId, beeId, kept);
    if (kept) r.completed++;
    else r.removed++;
    if (isOpenEarmark(t)) r.open--;
  }

  // 2. Queued tips with no todo, oldest first, while there is room.
  if (!complete) {
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
  if (queued.length === 0) return r;
  const claimed = new Set((await db()`
    select bee_id from bee_sync where bee_object = 'todo'
    union select bee_todo_id from recommendations where bee_todo_id is not null`).map((x) => Number(x.bee_id)));
  const base = d.env.EARMARK_PUBLIC_BASE_URL || DEFAULT_BASE_URL;

  for (const row of queued) {
    if (r.open >= MAX_OPEN_TODOS || writes >= MAX_WRITES_PER_RUN) return r;
    const recId = Number(row.id);
    const text = formatTodoText({ ...row, id: recId } as Parameters<typeof formatTodoText>[0], base);
    const old = row.old_id == null ? undefined : inBee.get(Number(row.old_id));
    const twin = old ? undefined : openEarmark.find((t) => t.text === text && !claimed.has(t.id));
    let beeId: number;
    if (old) {
      // Re-queued after it was tried: reopen its own todo rather than leave a second one behind.
      const out = await write("reopen", recId, () => d.bee.updateTodo(old.id, { text, completed: false }));
      if (out === "failed") return r;
      if (out === "gone") continue; // deleted in Bee meanwhile: next run creates a new one
      beeId = old.id;
    } else if (twin) {
      beeId = twin.id; // made by a run that crashed before saving: adopt, don't duplicate
    } else {
      const out = await write("create", recId, () => d.bee.createTodo({ text }));
      if (out === "failed" || out === "gone") return r;
      beeId = out.id;
    }
    if (!(await saveQueued(recId, beeId, text))) {
      // The tip left "queued" (or was forgotten) while Bee worked: take the todo back out, don't orphan it.
      if ((await write("undo", recId, () => d.bee.deleteTodo(beeId))) === "failed") return r;
      continue;
    }
    claimed.add(beeId);
    if (twin) r.adopted++;
    else {
      r.created++;
      r.open++;
    }
  }
  return r;
}

// Only while the tip is still queued without a todo; one statement, so the rec and bee_sync never disagree.
async function saveQueued(recId: number, beeId: number, text: string): Promise<boolean> {
  const rows = await db()`
    with r as (
      update recommendations set bee_todo_id = ${beeId}
      where id = ${recId} and status = 'queued' and bee_todo_id is null returning id)
    insert into bee_sync (entity_type, entity_id, bee_object, bee_id, last_written_state, last_synced_at)
    select 'rec', id, 'todo', ${beeId}, ${JSON.stringify({ text, completed: false })}::jsonb, now() from r
    on conflict (entity_type, entity_id, bee_object)
    do update set bee_id = excluded.bee_id, last_written_state = excluded.last_written_state, last_synced_at = now()
    returning entity_id`;
  return rows.length > 0;
}

// kept = Bee still holds the todo, completed: its bee_sync row stays (forget deletes it from Bee; a re-queue reopens
// it). Otherwise the todo is gone and so is the row. Either way the tip no longer has an open todo.
async function saveLeft(recId: number, beeId: number, kept: boolean): Promise<void> {
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
