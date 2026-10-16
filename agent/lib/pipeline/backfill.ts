import { toDate } from "../bee/client";
import { isJournalComplete } from "../bee/events";
import { pruneUtteranceBuffer } from "../store/conversations";
import { processConversation, resolveDeps, type PipelineDeps } from "./process-conversation";
import { processJournal } from "./process-journal";

const MAX_PAGES = 20; // hard stop so a Bee ordering surprise cannot loop forever
const PAGE_SIZE = 20;

type Page<T> = { items: T[]; next_cursor: string | null };

// Walk next_cursor pages (newest first) and return items at or after the cutoff.
// Stops when a page's oldest item is older than the cutoff, the cursor ends, or MAX_PAGES is hit.
async function collectSince<T>(
  fetchPage: (cursor?: string) => Promise<Page<T>>,
  at: (item: T) => number,
  cutoff: number,
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  for (let n = 0; n < MAX_PAGES; n++) {
    const page = await fetchPage(cursor);
    out.push(...page.items.filter((i) => at(i) >= cutoff));
    const oldest = Math.min(...page.items.map(at));
    if (!page.next_cursor || page.items.length === 0 || oldest < cutoff) break;
    cursor = page.next_cursor;
  }
  return out;
}

export const DEFAULT_BUDGET_MS = 240_000;
const STOP_CLAIMING_AT = 0.7; // leave 30% of the budget for the item already running to finish

export interface BackfillResult { conversations: number; journals: number; failed: number; stoppedEarly: boolean }

export async function runBackfill(
  opts: { hours?: number; budgetMs?: number; deps?: Partial<PipelineDeps> } = {},
): Promise<BackfillResult> {
  const d = resolveDeps(opts.deps ?? {});
  const startedAt = d.now().getTime();
  const cutoff = startedAt - (opts.hours ?? 48) * 3_600_000;
  const ms = (v: number | string | null | undefined) => toDate(v)?.getTime() ?? 0;
  const result: BackfillResult = { conversations: 0, journals: 0, failed: 0, stoppedEarly: false };
  // Past 70% of the budget no NEW item is claimed; whatever is left is picked up by the next run.
  const outOfTime = () => {
    if (d.now().getTime() - startedAt >= (opts.budgetMs ?? DEFAULT_BUDGET_MS) * STOP_CLAIMING_AT) result.stoppedEarly = true;
    return result.stoppedEarly;
  };
  // Log id + error name only: messages can echo transcript text.
  const fail = (kind: string, id: string | number, err: unknown) => {
    result.failed++;
    console.error(`[backfill] ${kind} failed id=${id} error=${err instanceof Error ? err.name : "unknown"}`);
  };

  // Voice notes first: they are explicit "Earmark that" captures and cheap, so a long conversation cannot starve them.
  const journals = await collectSince(
    async (cursor) => {
      const r = await d.bee.listJournals({ limit: PAGE_SIZE, cursor });
      return { items: r.journals, next_cursor: r.next_cursor };
    },
    (j) => ms(j.created_at),
    cutoff,
  );
  for (const j of journals) {
    if (!isJournalComplete(j.state) || !j.text?.trim()) continue;
    if (outOfTime()) break;
    try {
      const r = await processJournal({ id: j.id, text: j.text, createdAt: toDate(j.created_at) ?? d.now() }, d);
      if (r.created) result.journals++;
    } catch (err) {
      fail("journal", j.id, err);
    }
  }

  if (!result.stoppedEarly) {
    const convs = await collectSince(
      async (cursor) => {
        const r = await d.bee.listConversations({ limit: PAGE_SIZE, cursor });
        return { items: r.conversations, next_cursor: r.next_cursor };
      },
      (c) => ms(c.start_time),
      cutoff,
    );
    for (const c of convs) {
      if (c.state !== "COMPLETED") continue;
      if (outOfTime()) break;
      try {
        if (!(await processConversation(c.id, d)).skipped) result.conversations++;
      } catch (err) {
        fail("conversation", c.id, err);
      }
    }
  }

  try {
    await pruneUtteranceBuffer(); // the stream path also prunes hourly; this covers nights the relay was off
  } catch (err) {
    console.error(`[backfill] prune failed error=${err instanceof Error ? err.name : "unknown"}`);
  }
  return result;
}
