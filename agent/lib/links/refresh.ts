import { randomUUID } from "node:crypto";
import { db } from "../db";
import { askBooleans } from "../decide/ask-booleans";
import { ensureRecEmbeddings, ideaPairCandidates, recIdeaCandidates } from "./candidates";
import { judgeIdeaPair, judgeRecFit } from "./judge";

// The budget (decision 026). A run makes at most MAX_CALLS_PER_RUN model calls (each Jev call, and one embedMany batch
// of new tips), and asks about any one idea or tip at most MAX_CALLS_PER_ITEM times, so one busy idea cannot take the
// whole run. Pairs already judged are skipped until one side changes. Whatever is left waits for the next hourly run.
// Cost (measured on the TEST branch: one idea-pair call read 657 input tokens): Jev $0.042/M input → a full run of
// 40 calls ≈ 26k tokens ≈ $0.0011; hourly, at most ≈ $0.03 a day. Most runs judge nothing and cost nothing.
export const MAX_CALLS_PER_RUN = 40;
export const MAX_CALLS_PER_ITEM = 5;
// Tips are judged after ideas, so a busy garden could starve them: ideas get at most what this reserve leaves.
export const CALLS_RESERVED_FOR_FITS = 15;
export const EMBED_BATCH = 50;
const MAX_FAILURES_IN_A_ROW = 3; // the gateway is down: stop instead of walking the whole list

// Upserts: a re-judge refreshes Jev's probability and judged_at, but never touches a link Tarik accepted or removed.
export async function writeIdeaPair(aId: number, bId: number, r: { related: number; sameIdea: number }): Promise<void> {
  const [a, b] = [String(Math.min(aId, bId)), String(Math.max(aId, bId))];
  await db()`
    insert into links (from_type, from_id, to_type, to_id, kind, confidence, judged_at)
    values ('idea', ${a}, 'idea', ${b}, 'related', ${r.related}, now()),
           ('idea', ${a}, 'idea', ${b}, 'merge_suggestion', ${r.sameIdea}, now())
    on conflict (from_type, from_id, to_type, to_id, kind) do update
      set confidence = excluded.confidence, judged_at = excluded.judged_at
      where links.status = 'suggested'`;
}

export async function writeRecFit(recId: number, ideaId: number, fits: number): Promise<void> {
  await db()`
    insert into links (from_type, from_id, to_type, to_id, kind, confidence, judged_at)
    values ('rec', ${String(recId)}, 'idea', ${String(ideaId)}, 'fits', ${fits}, now())
    on conflict (from_type, from_id, to_type, to_id, kind) do update
      set confidence = excluded.confidence, judged_at = excluded.judged_at
      where links.status = 'suggested'`;
}

export interface RefreshResult {
  calls: number; ideaPairs: number; recPairs: number; embedded: number; failed: number; skipped: number;
  /** another run held the lock: this one did nothing */
  busy: boolean;
}

// Hourly runs must not overlap (a slow run + the next would judge the same pairs twice and double the spend). A claimed
// row in sync_cursors, taken only when free or stale: the lease outlives the longest run (40 calls × 20 s timeout ≈
// 13 min, under eve's 800 s function limit), so a crashed run's lock frees itself.
const LOCK = "links_refresh_lock";
async function claimRun(token: string): Promise<boolean> {
  const rows = await db()`
    insert into sync_cursors (name, cursor) values (${LOCK}, ${token})
    on conflict (name) do update set cursor = excluded.cursor, updated_at = now()
      where sync_cursors.updated_at < now() - interval '15 minutes'
    returning name`;
  return rows.length > 0;
}
async function releaseRun(token: string): Promise<void> {
  await db()`delete from sync_cursors where name = ${LOCK} and cursor = ${token}`;
}

const errName = (err: unknown) => (err instanceof Error ? err.name : "unknown");

/**
 * One bounded pass: judge idea pairs, then tips against ideas, then embed new tips (judged next run).
 * Logs ids, counts and error names only, never idea or tip text.
 */
export async function refreshLinks(opts: { maxCalls?: number; ask?: typeof askBooleans } = {}): Promise<RefreshResult> {
  const maxCalls = opts.maxCalls ?? MAX_CALLS_PER_RUN;
  const token = randomUUID();
  if (!(await claimRun(token))) {
    console.log("[links] run skipped: another run holds the lock");
    return { calls: 0, ideaPairs: 0, recPairs: 0, embedded: 0, failed: 0, skipped: 0, busy: true };
  }
  try {
    return await run(maxCalls, opts.ask ?? askBooleans);
  } finally {
    await releaseRun(token);
  }
}

async function run(maxCalls: number, ask: typeof askBooleans): Promise<RefreshResult> {
  const out: RefreshResult = { calls: 0, ideaPairs: 0, recPairs: 0, embedded: 0, failed: 0, skipped: 0, busy: false };
  // the reserve scales down for a small manual cap (--max-calls 1 still judges one idea pair)
  const ideaBudget = maxCalls - Math.min(CALLS_RESERVED_FOR_FITS, Math.floor((maxCalls * CALLS_RESERVED_FOR_FITS) / MAX_CALLS_PER_RUN));
  const perItem = new Map<string, number>();
  let failuresInARow = 0;
  const halted = () => out.calls >= maxCalls || failuresInARow >= MAX_FAILURES_IN_A_ROW;

  // Spends one call on these items, or refuses (and counts a skip) when any of them is spent for this run.
  const spend = (items: string[]) => {
    if (items.some((k) => (perItem.get(k) ?? 0) >= MAX_CALLS_PER_ITEM)) {
      out.skipped++;
      return false;
    }
    for (const k of items) perItem.set(k, (perItem.get(k) ?? 0) + 1);
    out.calls++;
    return true;
  };
  const judged = async (what: string, ids: string, run: () => Promise<void>) => {
    try {
      await run();
      failuresInARow = 0;
      return true;
    } catch (err) {
      out.failed++;
      failuresInARow++;
      console.error(`[links] ${what} failed ${ids} error=${errName(err)}`);
      return false;
    }
  };

  for (const p of await ideaPairCandidates(ideaBudget)) {
    if (halted() || out.calls >= ideaBudget) break;
    if (!spend([`idea:${p.a.id}`, `idea:${p.b.id}`])) continue;
    if (await judged("idea pair", `a=${p.a.id} b=${p.b.id}`, async () => writeIdeaPair(p.a.id, p.b.id, await judgeIdeaPair(p.a, p.b, ask)))) {
      out.ideaPairs++;
    }
  }

  if (!halted()) {
    for (const f of await recIdeaCandidates(maxCalls - out.calls)) {
      if (halted()) break;
      if (!spend([`rec:${f.rec.id}`, `idea:${f.idea.id}`])) continue;
      if (await judged("rec fit", `rec=${f.rec.id} idea=${f.idea.id}`, async () => writeRecFit(f.rec.id, f.idea.id, (await judgeRecFit(f.rec, f.idea, ask)).fits))) {
        out.recPairs++;
      }
    }
  }

  if (!halted()) {
    try {
      out.embedded = await ensureRecEmbeddings(EMBED_BATCH);
      if (out.embedded > 0) out.calls++;
    } catch (err) {
      out.calls++;
      out.failed++;
      console.error(`[links] embed tips failed error=${errName(err)}`);
    }
  }

  console.log(
    `[links] run calls=${out.calls} ideaPairs=${out.ideaPairs} recPairs=${out.recPairs} embedded=${out.embedded} ` +
      `failed=${out.failed} skipped=${out.skipped} cap=${maxCalls}`,
  );
  return out;
}
