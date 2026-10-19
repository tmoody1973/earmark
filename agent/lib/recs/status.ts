// The rec status core (M3-T2): every change to a tip's status goes through setRecStatus. One guarded statement
// (compare-and-set on the current status, row locked), then afterStatusChange runs the side effects.
import { db } from "../db";
import type { Rating, RecStatus } from "../types";
import { STATUS_EFFECTS, type StatusChange, type StatusEffect, type StatusOrigin } from "./status-effects";

export type { StatusChange, StatusEffect, StatusOrigin } from "./status-effects";

// The order of the status check in migration 001, then 044's overheard.
export const REC_STATUSES: readonly RecStatus[] = ["needs_review", "new", "queued", "tried", "thanked", "dismissed", "composted", "overheard"];
/**
 * The one visibility rule for tips (decision 025): the shelf, the taste ledger and a person's page all hide these.
 * needs_review tips (Earmark wasn't sure) live only in the Maybe? row until Tarik keeps or clears them; overheard tips
 * (nobody recommended them, decision 052) only in Heard nearby (/heard), and the rec lane never looks them up.
 * Defined here, not in garden/queries.ts (which re-exports it), so the status core can guard on it without a cycle.
 */
export const HIDDEN_TIP_STATUSES: readonly RecStatus[] = ["dismissed", "composted", "needs_review", "overheard"];
const CLEARED: readonly RecStatus[] = ["dismissed", "composted"];
const PLACED_BY_EARMARK: readonly RecStatus[] = ["needs_review", "new"];

/**
 * May a tip move from `from` to `to` when the change comes from `origin`? Pure.
 * Tarik's own surfaces (garden, Notion, Slack) may move anything. Bee's todo sync may never bring back a tip he
 * dismissed or composted. The system (sweeps, re-sorts) moves only tips Earmark itself placed, never a user-set state.
 */
export function mayMove(from: RecStatus, to: RecStatus, origin: StatusOrigin): boolean {
  if (from === to) return false;
  if (origin === "system") return PLACED_BY_EARMARK.includes(from);
  if (origin === "bee") return !CLEARED.includes(from);
  return true;
}

/** Every status a move to `to` may start from, narrowed by the caller's own guard (`only`). Pure. */
export function allowedFrom(to: RecStatus, origin: StatusOrigin, only?: readonly RecStatus[]): RecStatus[] {
  return REC_STATUSES.filter((s) => mayMove(s, to, origin) && (!only || only.includes(s)));
}

// The recommenders.recs_* counters, recounted (idempotent, survives retries and deletes). Same recipe as the insert
// path (recs_given = every tip) and forget-rows.ts. ponytail: nothing reads these columns yet (the taste ledger counts
// live, decision 024); kept true so they never drift.
export async function recomputeRecommender(recommenderId: number): Promise<void> {
  await db()`
    update recommenders p set
      recs_given = (select count(*) from recommendations r where r.recommender_id = p.id),
      recs_tried = (select count(*) from recommendations r where r.recommender_id = p.id and r.status in ('tried', 'thanked')),
      recs_loved = (select count(*) from recommendations r where r.recommender_id = p.id and r.rating = 'loved')
    where p.id = ${recommenderId}`;
}

const RECOMMENDER_COUNTS: StatusEffect = {
  name: "recommender-counts",
  run: async (c) => { if (c.recommenderId !== null) await recomputeRecommender(c.recommenderId); },
};

// notion: M3-T2b when NOTION_TOKEN exists — registers its push in STATUS_EFFECTS (status-effects.ts), as M3-T7's
// bee-todos does; nothing here changes.
async function afterStatusChange(change: StatusChange, effects: readonly StatusEffect[]): Promise<void> {
  for (const fx of effects) {
    try {
      await fx.run(change);
    } catch (err) {
      console.error(`[status] effect=${fx.name} rec=${change.recId} error=${err instanceof Error ? err.name : "unknown"}`);
    }
  }
}

export interface SetStatusOptions {
  /** Act only while the tip is in one of these statuses (on top of mayMove). */
  from?: readonly RecStatus[];
  /** Tarik's Maybe? tap (decision 025), saved in the same statement as the status. */
  verdict?: "kept" | "not_a_tip";
  /** Tests inject their own; defaults to STATUS_EFFECTS. */
  effects?: readonly StatusEffect[];
  /**
   * Runs the effects later instead of awaiting them. The Next.js server actions pass after() so a tap never waits on
   * Bee; agent code (schedules, tools) must never import next/*, since eve evaluates it outside Next.
   */
  defer?: (fn: () => Promise<void>) => void;
}

const assertRecId = (id: number) => {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("invalid rec id");
};

export async function setRecStatus(
  recId: number, next: RecStatus, origin: StatusOrigin, opts: SetStatusOptions = {},
): Promise<{ changed: boolean; previous: RecStatus | null }> {
  assertRecId(recId);
  const from = allowedFrom(next, origin, opts.from);
  if (from.length === 0) return { changed: false, previous: null };
  const verdict = opts.verdict ?? null;
  // The locked subquery reads the row's latest status, so `previous` is exact and the guard can't be raced.
  const rows = await db()`
    update recommendations r set status = ${next}, updated_at = now(),
      user_verdict = coalesce(${verdict}::text, r.user_verdict),
      user_verdict_at = case when ${verdict}::text is null then r.user_verdict_at else now() end
    from (select id, status from recommendations where id = ${recId} for update) old
    where r.id = old.id and old.status = any(${from}::text[])
    returning old.status as previous, r.recommender_id`;
  if (!rows[0]) return { changed: false, previous: null };
  const previous = rows[0].previous as RecStatus;
  const recommenderId = rows[0].recommender_id == null ? null : Number(rows[0].recommender_id);
  const change: StatusChange = { recId, previous, next, origin, recommenderId };
  await afterStatusChange(change, [RECOMMENDER_COUNTS]);
  const effects = () => afterStatusChange(change, opts.effects ?? STATUS_EFFECTS);
  if (opts.defer) opts.defer(effects);
  else await effects();
  return { changed: true, previous };
}

export async function setRecRating(
  recId: number, rating: Rating | null, origin: StatusOrigin, opts: Pick<SetStatusOptions, "effects" | "defer"> = {},
): Promise<{ changed: boolean }> {
  assertRecId(recId);
  // A rating lands only on a tip the shelf shows: never on a maybe or a cleared tip, whoever sends it.
  const rows = await db()`
    update recommendations set rating = ${rating}, updated_at = now()
    where id = ${recId} and rating is distinct from ${rating}
      and status <> all(${HIDDEN_TIP_STATUSES}::text[])
    returning status, recommender_id`;
  if (!rows[0]) return { changed: false };
  // Rating something means you tried it; the status change recounts the recommender.
  if (rating && (rows[0].status === "new" || rows[0].status === "queued")) {
    const { changed } = await setRecStatus(recId, "tried", origin, { ...opts, from: ["new", "queued"] });
    if (changed) return { changed: true };
  }
  if (rows[0].recommender_id != null) await recomputeRecommender(Number(rows[0].recommender_id));
  return { changed: true };
}
