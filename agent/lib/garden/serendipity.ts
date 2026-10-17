// Serendipity (M4-T8, FR-34, decision 029): one forgotten tip or stalled idea at a time, on Home. Keep it, or let it
// compost. Recency only: no model call, no schedule; the pick is made at render time from two indexed reads.
import { db } from "../db";
import { gardenReadOnly } from "../e2e-guard";
import { setRecStatus, type SetStatusOptions } from "../recs/status";
import type { IdeaStage, RecStatus } from "../types";
import { toPlant, toRecCard, type GardenRecRow, type PlantRow, type PlantView, type RecCardData } from "./queries";

export type ItemType = "rec" | "idea";
export type ItemRef = { type: ItemType; id: number };

export interface SerendipityCandidate {
  type: ItemType;
  id: number;
  title: string;
  /** tip: when it was said or caught, whichever is later; idea: its last mention (or when it was made). */
  lastTouchedAt: Date;
  /** The last Keep or compost from Serendipity. */
  lastSurfacedAt: Date | null;
}

/** What the page shows: the item, with its own card or plant and how long ago it was heard. Serializable. */
export type SerendipityPick =
  | { type: "rec"; id: number; title: string; note: string; rec: RecCardData }
  | { type: "idea"; id: number; title: string; note: string; plant: PlantView };

// Tips on the shelf and not yet tried (a subset of what HIDDEN_TIP_STATUSES leaves visible), and ideas still growing.
// A ready idea already leads the garden; drafted, used and dismissed ones never move (003_compost.sql).
export const FORGETTABLE_TIP_STATUSES: readonly RecStatus[] = ["new", "queued"];
export const STALLED_IDEA_STAGES: readonly IdeaStage[] = ["compost", "sprouting"];

// ponytail: week-one values (history starts Oct 15). Raise to 14 / 21 / 7 after a month of data.
export const REC_FORGOTTEN_DAYS = 3;
export const IDEA_STALLED_DAYS = 4;
export const SURFACE_COOLDOWN_DAYS = 1;

const DAY = 86_400_000;
const ageDays = (d: Date, now: Date) => (now.getTime() - d.getTime()) / DAY;

export function isForgotten(c: SerendipityCandidate, now: Date): boolean {
  const limit = c.type === "rec" ? REC_FORGOTTEN_DAYS : IDEA_STALLED_DAYS;
  if (ageDays(c.lastTouchedAt, now) < limit) return false;
  return c.lastSurfacedAt === null || ageDays(c.lastSurfacedAt, now) >= SURFACE_COOLDOWN_DAYS;
}

/** The most forgotten eligible item: the one longest since it was last touched or surfaced. */
export function pickSerendipity<T extends SerendipityCandidate>(cands: readonly T[], now: Date): T | null {
  const key = (c: T) => Math.max(c.lastTouchedAt.getTime(), c.lastSurfacedAt?.getTime() ?? 0);
  return cands.filter((c) => isForgotten(c, now)).sort((a, b) => key(a) - key(b) || a.id - b.id)[0] ?? null;
}

export function heardNote(lastTouchedAt: Date, now: Date): string {
  const n = Math.max(1, Math.floor(ageDays(lastTouchedAt, now)));
  return `Heard ${n} ${n === 1 ? "day" : "days"} ago`;
}

type Stamps = { last_touched_at: Date | string; last_surfaced_at: Date | string | null };
const stamps = (r: Stamps) => ({
  lastTouchedAt: new Date(r.last_touched_at),
  lastSurfacedAt: r.last_surfaced_at === null ? null : new Date(r.last_surfaced_at),
});

// ponytail: the 100 least recently touched of each kind, ordered by the same key pickSerendipity uses; a garden with
// more than 100 recently kept items ahead of an eligible one would miss it for a day. Filter in SQL if that happens.
const READ_MAX = 100;

/** `onPage`: items the page already shows (Home's first ideas and tips); never picked, so nothing appears twice. */
export async function getSerendipity(now = new Date(), onPage: readonly ItemRef[] = []): Promise<SerendipityPick | null> {
  const shown = new Set(onPage.map((r) => `${r.type}:${r.id}`));
  const sql = db();
  // The shelf's columns only (queries.ts): raw_text and excerpts never reach this path.
  const tips = (await sql`
    select r.id, r.type, r.canonical_name, r.creator, r.year_or_address, r.image_url,
      r.context_summary, r.said_at, r.created_at, r.status, r.rating, r.lat, r.lng, r.links,
      p.id as recommender_id, p.first_name,
      greatest(r.said_at, r.created_at) as last_touched_at, r.last_surfaced_at
    from recommendations r left join recommenders p on p.id = r.recommender_id
    where r.status = any(${FORGETTABLE_TIP_STATUSES}::text[])
    order by greatest(r.said_at, r.created_at, r.last_surfaced_at), r.id
    limit ${READ_MAX}`) as Array<GardenRecRow & Stamps>;
  const ideas = (await sql`
    select c.id, c.title, c.stage, c.mention_count, c.last_mentioned_at, c.pinned, c.timeline,
      (c.flagged_at is not null and (c.last_viewed_at is null or c.flagged_at > c.last_viewed_at)) as flagged,
      exists (select 1 from idea_mentions m where m.cluster_id = c.id and m.review_status = 'accepted') as confirmed,
      array(select m.spoken_at from idea_mentions m where m.cluster_id = c.id and m.review_status = 'dismissed') as dismissed_at,
      coalesce(c.last_mentioned_at, c.created_at) as last_touched_at, c.last_surfaced_at
    from idea_clusters c
    where c.stage = any(${STALLED_IDEA_STAGES}::text[]) and c.mention_count > 0 and not c.pinned
    order by greatest(coalesce(c.last_mentioned_at, c.created_at), c.last_surfaced_at), c.id
    limit ${READ_MAX}`) as Array<PlantRow & Stamps>;
  const cands = [
    ...tips.map((r) => ({ type: "rec" as const, id: Number(r.id), title: r.canonical_name, ...stamps(r), row: r })),
    ...ideas.map((r) => ({ type: "idea" as const, id: Number(r.id), title: r.title, ...stamps(r), row: r })),
  ];
  const pick = pickSerendipity(cands.filter((c) => !shown.has(`${c.type}:${c.id}`)), now);
  if (!pick) return null;
  const base = { id: pick.id, title: pick.title, note: heardNote(pick.lastTouchedAt, now) };
  return pick.type === "rec"
    ? { type: "rec", ...base, rec: toRecCard(pick.row as GardenRecRow) }
    : { type: "idea", ...base, plant: toPlant(pick.row as PlantRow) };
}

const assertRef = ({ type, id }: ItemRef) => {
  if ((type !== "rec" && type !== "idea") || !Number.isSafeInteger(id) || id <= 0) throw new Error("invalid item");
};

/** Keep: it stays where it is and goes to the back of Serendipity's queue. False when it had moved on, or read-only. */
export async function keepItem(item: ItemRef): Promise<boolean> {
  assertRef(item);
  if (gardenReadOnly()) return false; // a real-data e2e run browses read-only (e2e-guard.ts)
  const rows = item.type === "rec"
    ? await db()`update recommendations set last_surfaced_at = now()
        where id = ${item.id} and status = any(${FORGETTABLE_TIP_STATUSES}::text[]) returning id`
    : await db()`update idea_clusters set last_surfaced_at = now()
        where id = ${item.id} and stage = any(${STALLED_IDEA_STAGES}::text[]) returning id`;
  return rows.length > 0;
}

export type CompostResult = { changed: boolean; previous: RecStatus | IdeaStage | null };

/**
 * Let it compost. A tip goes through the status core (M3-T2), whose bee-todos effect deletes its Bee todo when it
 * leaves "queued"; `defer` (after() from the server action) runs that once the response is sent. An idea is dismissed:
 * it leaves the garden and its page stays, greyed. Both only from what Serendipity offers, so never a drafted or used
 * idea. Reversible with undoCompost.
 */
export async function compostItem(item: ItemRef, opts: Pick<SetStatusOptions, "defer"> = {}): Promise<CompostResult> {
  assertRef(item);
  if (gardenReadOnly()) return { changed: false, previous: null };
  const sql = db();
  if (item.type === "rec") {
    const r = await setRecStatus(item.id, "composted", "garden", { from: FORGETTABLE_TIP_STATUSES, ...opts });
    if (r.changed) await sql`update recommendations set last_surfaced_at = now() where id = ${item.id}`;
    return r;
  }
  // The locked subquery reads the row's latest stage, so the guard can't be raced by a mention joining (status.ts).
  const rows = (await sql`
    update idea_clusters c set stage = 'dismissed', last_surfaced_at = now(), updated_at = now()
    from (select id, stage from idea_clusters where id = ${item.id} for update) old
    where c.id = old.id and old.stage = any(${STALLED_IDEA_STAGES}::text[])
    returning old.stage as previous`) as Array<{ previous: IdeaStage }>;
  return rows[0] ? { changed: true, previous: rows[0].previous } : { changed: false, previous: null };
}

export type UndoRef = { type: "rec"; id: number; previous: RecStatus } | { type: "idea"; id: number };

/**
 * Undo a compost. A tip returns to the status it had (new or queued; queued gets its Bee todo back), only while it is
 * still composted. An idea regrows by the stage rule (idea_stage_for, so mentions that joined meanwhile count), only
 * one Serendipity dismissed in the last hour: an idea dismissed any other way, or merged away, stays dismissed.
 */
export async function undoCompost(ref: UndoRef, opts: Pick<SetStatusOptions, "defer"> = {}): Promise<boolean> {
  assertRef(ref);
  if (ref.type === "rec" && !FORGETTABLE_TIP_STATUSES.includes(ref.previous)) throw new Error("invalid previous status");
  if (gardenReadOnly()) return false;
  if (ref.type === "rec") return (await setRecStatus(ref.id, ref.previous, "garden", { from: ["composted"], ...opts })).changed;
  // Undo is offered right after the tap; an hour is generous and keeps the guard narrow.
  const rows = await db()`
    update idea_clusters set stage = idea_stage_for('compost', mention_count), updated_at = now()
    where id = ${ref.id} and stage = 'dismissed' and mention_count > 0
      and last_surfaced_at > now() - interval '1 hour'
    returning id`;
  return rows.length > 0;
}
