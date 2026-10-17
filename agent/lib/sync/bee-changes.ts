import { createBeeClient, toDate, type BeeChanges, type BeeClient } from "../bee/client";
import { isJournalComplete } from "../bee/events";
import { processConversation } from "../pipeline/process-conversation";
import { processJournal } from "../pipeline/process-journal";
import { SystemicTriageError } from "../pipeline/triage";
import { getCursor, getPending, savePending, saveCursor, type Pending } from "../store/sync-cursors";
import { BeeTodoLeaseBusy, handleFactChange, handleTodoChange } from "./handlers";

export const BEE_CHANGES_CURSOR = "bee_changes";
export const DEFAULT_BUDGET_MS = 240_000; // same function budget as the nightly backfill
const STOP_CLAIMING_AT = 0.7; // past this share of the budget no NEW item is started
const PENDING_TTL_MS = 48 * 3_600_000; // same window as the nightly backfill, which is the backstop after this
const CONVERSATION_DEADLINE_AT = 0.9; // a conversation still running here stops, saves nothing, releases its claim
export const MAX_CHANGE_ATTEMPTS = 5; // a todo change failing this many runs is dropped; a fact is logged once and kept
export const MAX_RETRY_IDS = 200; // todo + fact ids on the retry list

type Retries = { todo: Map<number, number>; fact: Map<number, number> }; // id → failed attempts so far

export interface NormalizedChanges {
  conversations: number[];
  journals: string[];
  todos: number[];
  facts: number[];
  nextCursor: string;
}

type Item = BeeChanges["journals"][number];
const idOf = (x: Item): number | string => (typeof x === "object" ? x.id : x);
// Ids that are not integers are dropped, but counted and logged (kind + count only, never the values).
function numbers(kind: string, xs: Item[]): number[] {
  const all = xs.map((x) => Number(idOf(x)));
  const dropped = all.filter((n) => !Number.isInteger(n)).length;
  if (dropped > 0) console.error(`[bee-changes] dropped ids kind=${kind} count=${dropped}`);
  return [...new Set(all.filter(Number.isInteger))];
}

export function normalizeChanges(raw: BeeChanges): NormalizedChanges {
  return {
    conversations: numbers("conversations", raw.conversations),
    journals: [...new Set(raw.journals.map((x) => String(idOf(x))))],
    todos: numbers("todos", raw.todos),
    facts: numbers("facts", raw.facts),
    nextCursor: raw.next_cursor,
  };
}

export interface ChangesDeps {
  bee: Pick<BeeClient, "changes" | "getJournal">;
  processConversation: typeof processConversation;
  processJournal: typeof processJournal;
  handleTodoChange: typeof handleTodoChange;
  handleFactChange: typeof handleFactChange;
  now: () => Date;
  budgetMs: number;
}

export interface ChangesResult {
  conversations: number;
  journals: number;
  todos: number;
  facts: number;
  failed: number;
  gone: number; // 404: Bee no longer has the item
  pending: number; // items waiting (still capturing / transcribing) after this run
  cursorSaved: boolean;
}

type Outcome = "done" | "pending" | "gone" | "failed" | "incomplete";

const isGone = (err: unknown) => (err as { status?: number } | null)?.status === 404;

// At-least-once: every conversation/journal goes through the claim-deduping pipelines, so replaying a batch is safe.
// The cursor moves only when the feed was fetched and parsed, nothing systemic threw, and the run finished its list.
// ponytail: a single item that fails (even every time) does NOT hold the cursor: it stays unclaimed and the nightly
// backfill (48 h window, conversations + journals) retries it, so one poison item cannot freeze the feed. Ceiling: an
// item still failing after 48 h drops out of automatic retry; add a dead-letter table if that ever happens.
// Items that are merely not ready (conversation CAPTURING, voice note still transcribing) go on a pending list kept in
// sync_cursors; each run retries it before reading the feed, and it is saved even when the cursor is held.
// ponytail: a conversation bigger than one function budget holds the cursor and re-spends model calls every run until
// it is processed locally (scripts/backfill-once.ts); add per-item progress if that happens.
export async function runBeeChangesSync(deps: Partial<ChangesDeps> = {}): Promise<ChangesResult> {
  const d: ChangesDeps = {
    bee: deps.bee ?? createBeeClient(),
    processConversation: deps.processConversation ?? processConversation,
    processJournal: deps.processJournal ?? processJournal,
    handleTodoChange: deps.handleTodoChange ?? handleTodoChange,
    handleFactChange: deps.handleFactChange ?? handleFactChange,
    now: deps.now ?? (() => new Date()),
    budgetMs: deps.budgetMs ?? DEFAULT_BUDGET_MS,
  };
  const startedAt = d.now().getTime();
  const [cursor, stored] = await Promise.all([getCursor(BEE_CHANGES_CURSOR), getPending()]);
  const pendC = new Map(stored.conversations.map((p) => [p.id, p.firstSeen]));
  const pendJ = new Map(stored.journals.map((p) => [p.id, p.firstSeen]));
  // ?? []: a pending list saved before M3-T8 has no todos/facts (getPending defaults them; mocks may not).
  const retries: Retries = {
    todo: new Map((stored.todos ?? []).map((p) => [p.id, p.attempts])),
    fact: new Map((stored.facts ?? []).map((p) => [p.id, p.attempts])),
  };
  const snapshot = (): Pending => ({
    conversations: [...pendC].map(([id, firstSeen]) => ({ id, firstSeen })),
    journals: [...pendJ].map(([id, firstSeen]) => ({ id, firstSeen })),
    todos: [...retries.todo].map(([id, attempts]) => ({ id, attempts })),
    facts: [...retries.fact].map(([id, attempts]) => ({ id, attempts })),
  });
  const before = JSON.stringify(snapshot());

  const result: ChangesResult = { conversations: 0, journals: 0, todos: 0, facts: 0, failed: 0, gone: 0, pending: 0, cursorSaved: false };
  try {
    await syncOnce(d, cursor, startedAt, pendC, pendJ, retries, result);
  } finally {
    result.pending = pendC.size + pendJ.size + retries.todo.size + retries.fact.size;
    // Saved on every exit (success, held cursor, or throw) so a not-ready item is never forgotten.
    if (JSON.stringify(snapshot()) !== before) {
      await savePending(snapshot()).catch((err: unknown) =>
        console.error(`[bee-changes] pending save failed error=${err instanceof Error ? err.name : "unknown"}`));
    }
  }
  return result;
}

async function syncOnce(
  d: ChangesDeps, cursor: string | null, startedAt: number,
  pendC: Map<number, string>, pendJ: Map<string, string>, retries: Retries, result: ChangesResult,
): Promise<void> {
  let unfinished = false; // stopped early or a conversation hit its deadline: some listed item was not processed
  const outOfTime = () => d.now().getTime() - startedAt >= d.budgetMs * STOP_CLAIMING_AT;
  const deadline = startedAt + d.budgetMs * CONVERSATION_DEADLINE_AT;
  // Log id + error name only: messages can echo transcript text.
  const onError = (kind: string, id: string | number, err: unknown): Outcome => {
    if (isGone(err)) {
      result.gone++;
      console.error(`[bee-changes] ${kind} gone id=${id}`);
      return "gone";
    }
    if (err instanceof SystemicTriageError) throw err; // outage: stop the run, cursor stays
    result.failed++;
    console.error(`[bee-changes] ${kind} failed id=${id} error=${err instanceof Error ? err.name : "unknown"}`);
    return "failed";
  };

  async function conversation(id: number): Promise<Outcome> {
    try {
      const r = await d.processConversation(id, { deadline });
      if (r.incomplete) return "incomplete";
      if (r.skipped && r.reason === "capturing") return "pending";
      if (!r.skipped) result.conversations++; // other skips = already claimed (deduped)
      return "done";
    } catch (err) {
      return onError("conversation", id, err);
    }
  }
  async function journal(id: string): Promise<Outcome> {
    try {
      const j = await d.bee.getJournal(id);
      if (!isJournalComplete(j.state) || !j.text) return "pending";
      await d.processJournal({ id, text: j.text, createdAt: toDate(j.created_at) ?? d.now() });
      result.journals++;
      return "done";
    } catch (err) {
      return onError("journal", id, err);
    }
  }
  // done/gone leave the list; pending joins it (keeping its first-seen time); failed/incomplete leave it as it was.
  // An `incomplete` item (hit its deadline) holds the cursor only when it came from the feed: a pending item is already
  // tracked in the pending list, so it must not starve new items (decision: pending incomplete never holds the cursor).
  function settle<K>(map: Map<K, string>, id: K, outcome: Outcome, fromFeed: boolean): void {
    if (outcome === "pending") map.set(id, map.get(id) ?? d.now().toISOString());
    else if (outcome === "done" || outcome === "gone") map.delete(id);
    else if (outcome === "incomplete" && fromFeed) unfinished = true;
  }
  // An unreadable firstSeen counts as expired (logged with its id) rather than retrying forever.
  const expired = (firstSeen: string) => {
    const age = d.now().getTime() - Date.parse(firstSeen);
    return Number.isNaN(age) || age > PENDING_TTL_MS;
  };

  const triedC = new Set<number>();
  const triedJ = new Set<string>();
  // 1. Pending first.
  for (const [id, firstSeen] of [...pendC]) {
    if (expired(firstSeen)) { pendC.delete(id); console.error(`[bee-changes] pending conversation expired id=${id}`); continue; }
    if (outOfTime()) { unfinished = true; break; }
    triedC.add(id);
    settle(pendC, id, await conversation(id), false);
  }
  for (const [id, firstSeen] of [...pendJ]) {
    if (expired(firstSeen)) { pendJ.delete(id); console.error(`[bee-changes] pending journal expired id=${id}`); continue; }
    if (unfinished || outOfTime()) { unfinished = true; break; }
    triedJ.add(id);
    settle(pendJ, id, await journal(id), false);
  }
  if (unfinished) { console.error("[bee-changes] out of time; cursor not advanced"); return; }

  // 2. Then the feed (a fetch or schema error throws: cursor not saved).
  const c = normalizeChanges(await d.bee.changes(cursor ?? undefined));
  for (const id of c.conversations) {
    if (triedC.has(id)) continue;
    if (outOfTime()) { unfinished = true; break; }
    settle(pendC, id, await conversation(id), true);
  }
  for (const id of c.journals) {
    if (unfinished || triedJ.has(id)) continue;
    if (outOfTime()) { unfinished = true; break; }
    settle(pendJ, id, await journal(id), true);
  }
  if (unfinished) { console.error("[bee-changes] out of time; cursor not advanced"); return; }

  // 3. Todo/fact changes: earlier failures first, then the feed's, each id once per run. Handlers are idempotent and
  // re-read Bee, so a retry by id is the whole change. One that throws goes on the retry list and the cursor still
  // advances (a poison todo can't freeze the feed). A todo is dropped after MAX_CHANGE_ATTEMPTS (the reconciler's
  // backstop re-checks every linked tip, so nothing is lost); a fact never is. Out of time: the rest wait, no attempt.
  await runChanges("todo", [...retries.todo.keys(), ...c.todos], d.handleTodoChange, retries, result, outOfTime);
  await runChanges("fact", [...retries.fact.keys(), ...c.facts], d.handleFactChange, retries, result, outOfTime);

  await saveCursor(BEE_CHANGES_CURSOR, c.nextCursor);
  result.cursorSaved = true;
}

// Put an id on the retry list. Ids already there always stay (oldest kept); a new one past MAX_RETRY_IDS is not added
// and waits for the feed to list it again (a todo is also covered by the reconciler's backstop).
function keepForRetry(retries: Retries, kind: "todo" | "fact", id: number, attempts: number): void {
  if (!retries[kind].has(id) && retries.todo.size + retries.fact.size >= MAX_RETRY_IDS) {
    console.error(`[bee-changes] retry list full; ${kind} id=${id} waits for the feed`);
    return;
  }
  retries[kind].set(id, attempts);
}

async function runChanges(
  kind: "todo" | "fact", ids: number[], handle: (id: number) => Promise<void>, retries: Retries,
  result: ChangesResult, outOfTime: () => boolean,
): Promise<void> {
  const retry = retries[kind];
  for (const id of new Set(ids)) {
    if (outOfTime()) {
      keepForRetry(retries, kind, id, retry.get(id) ?? 0);
      continue;
    }
    try {
      await handle(id);
      retry.delete(id);
      result[kind === "todo" ? "todos" : "facts"]++;
    } catch (err) {
      if (err instanceof BeeTodoLeaseBusy) {
        keepForRetry(retries, kind, id, retry.get(id) ?? 0); // another todo writer is running: not a failure
        continue;
      }
      const attempts = (retry.get(id) ?? 0) + 1;
      const name = err instanceof Error ? err.name : "unknown";
      result.failed++;
      if (kind === "todo" && attempts >= MAX_CHANGE_ATTEMPTS) {
        retry.delete(id);
        console.error(`[bee-changes] todo gave up id=${id} attempts=${attempts} error=${name}`);
        continue;
      }
      keepForRetry(retries, kind, id, attempts);
      console.error(attempts === MAX_CHANGE_ATTEMPTS
        ? `[bee-changes] fact still failing id=${id} attempts=${attempts} error=${name}; keeps retrying every run`
        : `[bee-changes] ${kind} failed id=${id} attempts=${attempts} error=${name}`);
    }
  }
}
