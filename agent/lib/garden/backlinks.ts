import { db } from "../db";
import { gardenReadOnly } from "../e2e-guard";
import { LINK_MIN, MERGE_MIN } from "../links/criteria";
import { HIDDEN_TIP_STATUSES, toPlant, toRecCard, type GardenRecRow, type PlantRow, type PlantView, type RecCardData } from "./queries";

// Backlinks on the idea page (FR-38, M4-T6). Jev's judgements live in `links` (agent/lib/links/refresh.ts); this reads
// what the page shows and records Tarik's accept / remove. Idea pairs are stored once, smaller id first.

export type LinkKind = "related" | "fits" | "merge_suggestion";
export type LinkStatus = "suggested" | "accepted";
export interface LinkKey { fromType: "idea" | "rec"; fromId: number; toType: "idea"; toId: number; kind: LinkKind }
export interface IdeaBacklink { key: LinkKey; status: LinkStatus; plant: PlantView }
export interface RecBacklink { key: LinkKey; status: LinkStatus; rec: RecCardData }
export interface MergeRef { mergeId: number; ideaId: number; title: string; at: string }
export interface Backlinks {
  related: IdeaBacklink[];
  fits: RecBacklink[];
  /** "Same idea?" suggestions, still open. */
  sameIdea: IdeaBacklink[];
  /** This idea was merged into another (it is dismissed; its page offers Undo). */
  mergedInto: MergeRef | null;
  /** Ideas merged into this one, each undoable. */
  mergedIn: MergeRef[];
}

const MAX_SHOWN = 12;
const iso = (d: Date | string) => new Date(d).toISOString();

/**
 * What the idea page shows. A suggestion shows at or above its floor (LINK_MIN, MERGE_MIN); a link Tarik accepted
 * always shows; a removed one never does. The other side must itself be visible: a growing idea with a counted
 * mention, or a tip the shelf shows (HIDDEN_TIP_STATUSES: maybes, dismissed and composted tips never surface here).
 */
export async function getBacklinks(ideaId: number): Promise<Backlinks> {
  const sql = db();
  const id = String(ideaId);
  const ideas = (await sql`
    select l.kind, l.status as link_status, l.from_id, l.to_id,
      c.id, c.title, c.stage, c.mention_count, c.last_mentioned_at, c.pinned, c.timeline, false as flagged,
      exists (select 1 from idea_mentions m where m.cluster_id = c.id and m.review_status = 'accepted') as confirmed
    from links l
    join idea_clusters c on c.id::text = case when l.from_id = ${id} then l.to_id else l.from_id end
    where l.from_type = 'idea' and l.to_type = 'idea' and (l.from_id = ${id} or l.to_id = ${id})
      and l.status <> 'removed' and c.stage <> 'dismissed' and c.mention_count > 0 and not idea_is_quiet(c.id)
      and ((l.kind = 'related' and (l.status = 'accepted' or l.confidence >= ${LINK_MIN}))
        or (l.kind = 'merge_suggestion' and l.status = 'suggested' and l.confidence >= ${MERGE_MIN}))
    order by l.status = 'accepted' desc, l.confidence desc, c.id
    limit ${MAX_SHOWN * 2}`) as Array<PlantRow & { kind: LinkKind; link_status: LinkStatus; from_id: string; to_id: string }>;
  // Same columns as the shelf (queries.ts): raw_text and excerpts never reach the page through this path.
  const recs = (await sql`
    select l.status as link_status, l.from_id,
      r.id, r.type, r.canonical_name, r.creator, r.year_or_address, r.image_url,
      r.context_summary, r.said_at, r.created_at, r.status, r.rating, r.lat, r.lng, r.links,
      p.id as recommender_id, p.first_name
    from links l
    join recommendations r on r.id::text = l.from_id
    left join recommenders p on p.id = r.recommender_id
    where l.from_type = 'rec' and l.to_type = 'idea' and l.to_id = ${id} and l.kind = 'fits'
      and l.status <> 'removed' and (l.status = 'accepted' or l.confidence >= ${LINK_MIN})
      and r.status <> all(${HIDDEN_TIP_STATUSES}::text[])
    order by l.status = 'accepted' desc, l.confidence desc, r.id
    limit ${MAX_SHOWN}`) as Array<GardenRecRow & { link_status: LinkStatus; from_id: string }>;
  const merges = (await sql`
    select mg.id as merge_id, mg.keep_id, mg.merged_id, mg.merged_at, c.title
    from idea_merges mg
    join idea_clusters c on c.id = case when mg.keep_id = ${ideaId} then mg.merged_id else mg.keep_id end
    where mg.undone_at is null and (mg.keep_id = ${ideaId} or mg.merged_id = ${ideaId})
    order by mg.merged_at desc, mg.id desc`) as Array<{ merge_id: number; keep_id: number; merged_id: number; merged_at: Date | string; title: string }>;

  const ideaLink = (r: (typeof ideas)[number]): IdeaBacklink => ({
    key: { fromType: "idea", fromId: Number(r.from_id), toType: "idea", toId: Number(r.to_id), kind: r.kind },
    status: r.link_status,
    plant: toPlant(r),
  });
  const ref = (m: (typeof merges)[number], other: number): MergeRef =>
    ({ mergeId: Number(m.merge_id), ideaId: Number(other), title: m.title, at: iso(m.merged_at) });
  const into = merges.find((m) => Number(m.merged_id) === ideaId);
  // an idea offered as "same idea?" is not listed again under related ideas
  const offered = new Set(ideas.filter((r) => r.kind === "merge_suggestion").map((r) => Number(r.id)));
  return {
    related: ideas.filter((r) => r.kind === "related" && !offered.has(Number(r.id))).slice(0, MAX_SHOWN).map(ideaLink),
    sameIdea: ideas.filter((r) => r.kind === "merge_suggestion").slice(0, MAX_SHOWN).map(ideaLink),
    fits: recs.map((r) => ({
      key: { fromType: "rec", fromId: Number(r.from_id), toType: "idea", toId: ideaId, kind: "fits" },
      status: r.link_status,
      rec: toRecCard(r),
    })),
    mergedInto: into ? ref(into, into.keep_id) : null,
    mergedIn: merges.filter((m) => Number(m.keep_id) === ideaId).map((m) => ref(m, m.merged_id)),
  };
}

/**
 * Tarik's accept / remove. Accept only turns a suggestion into a link (a removed link is never revived); remove works
 * on a suggested or accepted link. True when a row changed.
 */
export async function setLinkStatus(k: LinkKey, status: "accepted" | "removed"): Promise<boolean> {
  if (gardenReadOnly()) return false; // a real-data e2e run browses read-only (e2e-guard.ts)
  const sql = db();
  const [fromId, toId] = [String(k.fromId), String(k.toId)];
  const rows = status === "accepted"
    ? await sql`
        update links set status = ${status}
        where from_type = ${k.fromType} and from_id = ${fromId} and to_type = ${k.toType} and to_id = ${toId}
          and kind = ${k.kind} and status = 'suggested'
        returning kind`
    : await sql`
        update links set status = ${status}
        where from_type = ${k.fromType} and from_id = ${fromId} and to_type = ${k.toType} and to_id = ${toId}
          and kind = ${k.kind} and status <> 'removed'
        returning kind`;
  return rows.length > 0;
}
