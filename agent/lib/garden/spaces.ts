import { db } from "../db";
import { gardenReadOnly } from "../e2e-guard";
import { SPACE_MIN, SPACES_LOCK } from "../spaces/criteria";
import { HIDDEN_TIP_STATUSES, toPlant, toRecCard, type GardenRecRow, type PlantRow, type PlantView, type RecCardData } from "./queries";

// Smart Spaces on the garden (FR-32, M4-T7, decision 028). Jev's judgements live in space_items
// (agent/lib/spaces/evaluate.ts); this reads what the pages show and records Tarik's keep / remove, rename and delete.

export interface SpaceSummary {
  id: number;
  name: string;
  /** The sentence Earmark fills the Space from; the name starts as this sentence and can be renamed. */
  sentence: string;
  members: number;
  /** Visible items Jev has not judged for this Space yet (never asked, or a failed call waiting for its retry). */
  pending: number;
  createdAt: string;
}
export type SpaceItemStatus = "suggested" | "accepted";
export interface SpaceItemKey { spaceId: number; itemType: "idea" | "rec"; itemId: number }
export interface SpaceIdea { status: SpaceItemStatus; plant: PlantView }
export interface SpaceTip { status: SpaceItemStatus; rec: RecCardData }
export interface SpaceView {
  space: SpaceSummary; ideas: SpaceIdea[]; tips: SpaceTip[];
  /** Items are left to sort and a pass is running (or about to: the Space is seconds old). False: the hourly run will. */
  sortingNow: boolean;
}

const items = (n: number) => `${n} ${n === 1 ? "item" : "items"}`;

/** The Spaces list's count line: "4 items · still sorting 12", "Still sorting 12", or "Nothing yet". Real counts only. */
export function spaceCounts(s: Pick<SpaceSummary, "members" | "pending">): string {
  if (s.members === 0) return s.pending > 0 ? `Still sorting ${s.pending}` : "Nothing yet";
  return s.pending > 0 ? `${items(s.members)} · still sorting ${s.pending}` : items(s.members);
}

// ponytail: a range guard, not paging (a Space of more than 60 of either has not happened yet).
const MAX_SHOWN = 60;

/**
 * Every Space, newest first (or one, by id). A member is an item Tarik kept, or a suggestion at or above SPACE_MIN;
 * a removed one never counts. Only items the garden itself shows count, as members or as still to sort: a growing
 * idea with a counted mention, or a tip the shelf shows (HIDDEN_TIP_STATUSES).
 */
export async function listSpaces(id: number | null = null): Promise<SpaceSummary[]> {
  const rows = (await db()`
    with v as (
      select 'idea'::text as item_type, c.id as item_id from idea_clusters c
      where c.stage <> 'dismissed' and c.mention_count > 0 and not idea_is_quiet(c.id)
      union all
      select 'rec', r.id from recommendations r where r.status <> all(${HIDDEN_TIP_STATUSES}::text[])
    )
    select s.id, s.name, s.rule_sentence, s.created_at,
      (count(*) filter (where si.status = 'accepted' or (si.status = 'suggested' and si.confidence >= ${SPACE_MIN})))::int as members,
      (count(*) filter (where v.item_id is not null and (si.space_id is null or si.confidence is null)))::int as pending
    from spaces s
    left join v on true
    left join space_items si on si.space_id = s.id and si.item_type = v.item_type and si.item_id = v.item_id
    where (${id}::bigint is null or s.id = ${id})
    group by s.id
    order by s.created_at desc, s.id desc`) as Array<{
      id: number | string; name: string; rule_sentence: string; created_at: Date | string; members: number; pending: number;
    }>;
  return rows.map((r) => ({
    id: Number(r.id),
    name: r.name,
    sentence: r.rule_sentence,
    members: Number(r.members),
    pending: Number(r.pending),
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

/** One Space and its members, Tarik's keeps first. Same columns as the shelf: raw_text and excerpts never reach it. */
export async function getSpace(id: number): Promise<SpaceView | null> {
  const [space] = await listSpaces(id);
  if (!space) return null;
  const sql = db();
  // the same 15-minute lease the pass takes (evaluate.ts), and the 30 s before a new Space's first fill takes it
  const sortingNow = space.pending > 0 && Boolean(((await sql`
    select (exists (select 1 from sync_cursors where name = ${SPACES_LOCK} and updated_at > now() - interval '15 minutes')
      or exists (select 1 from spaces where id = ${id} and created_at > now() - interval '30 seconds')) as sorting`) as Array<{ sorting: boolean }>)[0]?.sorting);
  const ideas = (await sql`
    select si.status as member_status,
      c.id, c.title, c.stage, c.mention_count, c.last_mentioned_at, c.pinned, c.timeline, false as flagged,
      exists (select 1 from idea_mentions m where m.cluster_id = c.id and m.review_status = 'accepted') as confirmed,
      array(select m.spoken_at from idea_mentions m where m.cluster_id = c.id and m.review_status = 'dismissed') as dismissed_at
    from space_items si join idea_clusters c on c.id = si.item_id
    where si.space_id = ${id} and si.item_type = 'idea' and c.stage <> 'dismissed' and c.mention_count > 0
      and not idea_is_quiet(c.id)
      and (si.status = 'accepted' or (si.status = 'suggested' and si.confidence >= ${SPACE_MIN}))
    order by si.status = 'accepted' desc, c.last_mentioned_at desc nulls last, c.id
    limit ${MAX_SHOWN}`) as Array<PlantRow & { member_status: SpaceItemStatus }>;
  const tips = (await sql`
    select si.status as member_status,
      r.id, r.type, r.canonical_name, r.creator, r.year_or_address, r.image_url,
      r.context_summary, r.said_at, r.created_at, r.status, r.rating, r.lat, r.lng, r.links, r.about, r.about_url,
      p.id as recommender_id, p.first_name
    from space_items si join recommendations r on r.id = si.item_id
    left join recommenders p on p.id = r.recommender_id
    where si.space_id = ${id} and si.item_type = 'rec' and r.status <> all(${HIDDEN_TIP_STATUSES}::text[])
      and (si.status = 'accepted' or (si.status = 'suggested' and si.confidence >= ${SPACE_MIN}))
    order by si.status = 'accepted' desc, r.said_at desc, r.id desc
    limit ${MAX_SHOWN}`) as Array<GardenRecRow & { member_status: SpaceItemStatus }>;
  return {
    space,
    sortingNow,
    ideas: ideas.map((r) => ({ status: r.member_status, plant: toPlant(r) })),
    tips: tips.map((r) => ({ status: r.member_status, rec: toRecCard(r) })),
  };
}

/** A new Space, named by its sentence. Null when the garden is read-only (nothing written). */
export async function createSpace(sentence: string): Promise<number | null> {
  if (gardenReadOnly()) return null; // a real-data e2e run browses read-only (e2e-guard.ts)
  const [row] = (await db()`
    insert into spaces (name, rule_sentence) values (${sentence}, ${sentence}) returning id`) as Array<{ id: number | string }>;
  return Number(row.id);
}

/** Renames a Space. What fills it stays its sentence (decision 028). True when a row changed. */
export async function renameSpace(id: number, name: string): Promise<boolean> {
  if (gardenReadOnly()) return false;
  const rows = await db()`update spaces set name = ${name} where id = ${id} and name <> ${name} returning id`;
  return rows.length > 0;
}

/** Deletes a Space and Jev's judgements for it (cascade); the ideas and tips themselves stay. True when it existed. */
export async function deleteSpace(id: number): Promise<boolean> {
  if (gardenReadOnly()) return false;
  const rows = await db()`delete from spaces where id = ${id} returning id`;
  return rows.length > 0;
}

/**
 * Tarik's keep / remove on an item in a Space. Keep only turns a suggestion into a member (a removed item is never
 * revived); remove works on a suggested or kept one. Neither is ever re-judged. True when a row changed.
 */
export async function setSpaceItemStatus(k: SpaceItemKey, status: "accepted" | "removed"): Promise<boolean> {
  if (gardenReadOnly()) return false;
  const sql = db();
  const rows = status === "accepted"
    ? await sql`
        update space_items set status = ${status}
        where space_id = ${k.spaceId} and item_type = ${k.itemType} and item_id = ${k.itemId} and status = 'suggested'
        returning space_id`
    : await sql`
        update space_items set status = ${status}
        where space_id = ${k.spaceId} and item_type = ${k.itemType} and item_id = ${k.itemId} and status <> 'removed'
        returning space_id`;
  return rows.length > 0;
}
