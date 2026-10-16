import { createBeeClient, toDate, type BeeChanges, type BeeClient } from "../bee/client";
import { isJournalComplete } from "../bee/events";
import { processConversation } from "../pipeline/process-conversation";
import { processJournal } from "../pipeline/process-journal";
import { SystemicTriageError } from "../pipeline/triage";
import { getCursor, saveCursor } from "../store/sync-cursors";
import { handleFactChange, handleTodoChange } from "./handlers";

export const BEE_CHANGES_CURSOR = "bee_changes";
export const DEFAULT_BUDGET_MS = 240_000; // same function budget as the nightly backfill
const STOP_CLAIMING_AT = 0.7; // past this share of the budget no NEW item is started
const CONVERSATION_DEADLINE_AT = 0.9; // a conversation still running here stops, saves nothing, releases its claim

export interface NormalizedChanges {
  conversations: number[];
  journals: string[];
  todos: number[];
  facts: number[];
  nextCursor: string;
}

type Item = BeeChanges["journals"][number];
const idOf = (x: Item): number | string => (typeof x === "object" ? x.id : x);
const numbers = (xs: Item[]) => [...new Set(xs.map((x) => Number(idOf(x))))].filter(Number.isInteger);

export function normalizeChanges(raw: BeeChanges): NormalizedChanges {
  return {
    conversations: numbers(raw.conversations),
    journals: [...new Set(raw.journals.map((x) => String(idOf(x))))],
    todos: numbers(raw.todos),
    facts: numbers(raw.facts),
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
  cursorSaved: boolean;
}

const isGone = (err: unknown) => (err as { status?: number } | null)?.status === 404;

// At-least-once: every conversation/journal goes through the claim-deduping pipelines, so replaying a batch is safe.
// The cursor moves only when the feed was fetched and parsed, nothing systemic threw, and the run finished its list.
// ponytail: a single item that fails (even every time) does NOT hold the cursor: it stays unclaimed and the nightly
// backfill (48 h window, conversations + journals) retries it, so one poison item cannot freeze the feed. Ceiling: an
// item still failing after 48 h drops out of automatic retry; add a dead-letter table if that ever happens.
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
  const cursor = await getCursor(BEE_CHANGES_CURSOR);
  const c = normalizeChanges(await d.bee.changes(cursor ?? undefined)); // a fetch or schema error throws: no cursor save

  const result: ChangesResult = { conversations: 0, journals: 0, todos: 0, facts: 0, failed: 0, cursorSaved: false };
  let unfinished = false; // stopped early or a conversation hit its deadline: some listed item was not processed
  const outOfTime = () => d.now().getTime() - startedAt >= d.budgetMs * STOP_CLAIMING_AT;
  // Log id + error name only: messages can echo transcript text.
  const fail = (kind: string, id: string | number, err: unknown) => {
    result.failed++;
    console.error(`[bee-changes] ${kind} failed id=${id} error=${err instanceof Error ? err.name : "unknown"}`);
  };
  // 404: Bee no longer has it, nothing to retry. Systemic outage: stop the run, cursor stays. Anything else: item-level.
  const itemFailure = (kind: string, id: string | number, err: unknown) => {
    if (isGone(err)) return;
    if (err instanceof SystemicTriageError) throw err;
    fail(kind, id, err);
  };

  const deadline = startedAt + d.budgetMs * CONVERSATION_DEADLINE_AT;
  for (const id of c.conversations) {
    if (outOfTime()) { unfinished = true; break; }
    try {
      const r = await d.processConversation(id, { deadline });
      if (r.incomplete) unfinished = true;
      else if (!r.skipped) result.conversations++; // skipped = already claimed or still CAPTURING (a later change lists it)
    } catch (err) {
      itemFailure("conversation", id, err);
    }
  }
  for (const id of c.journals) {
    if (unfinished) break;
    if (outOfTime()) { unfinished = true; break; }
    try {
      const journal = await d.bee.getJournal(id);
      if (!isJournalComplete(journal.state) || !journal.text) continue; // a later change will list it again
      await d.processJournal({ id, text: journal.text, createdAt: toDate(journal.created_at) ?? d.now() });
      result.journals++;
    } catch (err) {
      itemFailure("journal", id, err);
    }
  }
  if (unfinished) {
    console.error(`[bee-changes] out of time; cursor not advanced`);
    return result;
  }

  // Todo/fact handlers are M3/M5 hooks and idempotent: a throw here leaves the cursor so the batch replays.
  for (const id of c.todos) { await d.handleTodoChange(id); result.todos++; }
  for (const id of c.facts) { await d.handleFactChange(id); result.facts++; }

  await saveCursor(BEE_CHANGES_CURSOR, c.nextCursor);
  return { ...result, cursorSaved: true };
}
