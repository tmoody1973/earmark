import { embedMany } from "ai";
import { db } from "../db";
import { getEnv } from "../env";
import { HIDDEN_TIP_STATUSES } from "../garden/queries";
import { parseTimeline } from "../garden/timeline";
import { EMBED_DIMENSIONS, toVectorLiteral } from "../ideas/embed";
import { IDEA_PAIR_MAX_DISTANCE, NEIGHBOURS_PER_ITEM, REC_IDEA_MAX_DISTANCE } from "./criteria";
import { recEmbedText } from "../recs/embed-text";
import type { IdeaText, RecText } from "./judge";

export type IdeaRef = IdeaText & { id: number };
export type RecRef = RecText & { id: number };
export interface IdeaPairCandidate { a: IdeaRef; b: IdeaRef } // a.id < b.id, the order links rows use
export interface RecIdeaCandidate { rec: RecRef; idea: IdeaRef }

const EMBED_TIMEOUT_MS = 30_000;

type IdeaCols = { id: number | string; title: string; summary: string | null; timeline: unknown };
export const toIdea = (r: IdeaCols): IdeaRef => ({
  id: Number(r.id),
  title: r.title,
  summary: r.summary,
  notes: parseTimeline(r.timeline).map((e) => e.line).slice(-3), // the three newest, by date
});

/**
 * Fill recommendations.embedding for visible tips that lack one (one embedMany call), so tips can meet ideas.
 * The embedded text is the tip's type, name, creator and context summary: never the excerpt or raw text.
 */
export async function ensureRecEmbeddings(limit: number): Promise<number> {
  const sql = db();
  const rows = (await sql`
    select id, type, canonical_name, creator, context_summary from recommendations
    where embedding is null and status <> all(${HIDDEN_TIP_STATUSES}::text[])
    order by id limit ${limit}`) as Array<{ id: number; type: string; canonical_name: string; creator: string | null; context_summary: string | null }>;
  if (rows.length === 0) return 0;
  const values = rows.map((r) => recEmbedText({ type: r.type, name: r.canonical_name, creator: r.creator, contextSummary: r.context_summary }));
  // bounded like every model call in the hourly run (a hung batch must not hold the run lock)
  const { embeddings } = await embedMany({ model: getEnv().EMBED_MODEL, values, abortSignal: AbortSignal.timeout(EMBED_TIMEOUT_MS) });
  if (embeddings.length !== rows.length || embeddings.some((e) => e.length !== EMBED_DIMENSIONS)) {
    throw new Error(`ensureRecEmbeddings: expected ${rows.length} × ${EMBED_DIMENSIONS}-dim embeddings`);
  }
  // Two writers (the rec lane sweep and this hourly run): only while the text embedded is still the tip's text, so a
  // why or name written mid-call is never paired with the old vector.
  await sql.transaction(rows.map((r, i) =>
    sql`update recommendations set embedding = ${toVectorLiteral(embeddings[i]!)}::vector
      where id = ${r.id} and embedding is null and type = ${r.type} and canonical_name = ${r.canonical_name}
        and creator is not distinct from ${r.creator} and context_summary is not distinct from ${r.context_summary}`));
  return rows.length;
}

// A pair or a tip→idea fit needs Jev when it was never judged, or one side changed after it was (updated_at moved
// past judged_at, e.g. a new mention), and Tarik has not accepted or removed it (status still 'suggested').
// Visible ideas only: growing (not dismissed) and with at least one counted mention (the garden's own rule).
// ponytail: the `vis` CTE scans every visible idea per item (no HNSW); fine to a few thousand ideas, use per-item
// index lookups (order by centroid <=> x limit k on idea_clusters) past that.
export async function ideaPairCandidates(limit: number): Promise<IdeaPairCandidate[]> {
  const rows = (await db()`
    with vis as (
      select id, title, summary, timeline, centroid, updated_at from idea_clusters
      where stage <> 'dismissed' and mention_count > 0 and centroid is not null
    ), near as (
      select least(a.id, n.id) as lo, greatest(a.id, n.id) as hi, n.dist
      from vis a cross join lateral (
        select b.id, a.centroid <=> b.centroid as dist from vis b where b.id <> a.id
        order by a.centroid <=> b.centroid limit ${NEIGHBOURS_PER_ITEM}
      ) n
      where n.dist < ${IDEA_PAIR_MAX_DISTANCE}
    ), pairs as (select lo, hi, min(dist) as dist from near group by lo, hi)
    select a.id as a_id, a.title as a_title, a.summary as a_summary, a.timeline as a_timeline,
           b.id as b_id, b.title as b_title, b.summary as b_summary, b.timeline as b_timeline
    from pairs p join vis a on a.id = p.lo join vis b on b.id = p.hi
    left join links l on l.from_type = 'idea' and l.from_id = p.lo::text and l.to_type = 'idea' and l.to_id = p.hi::text
      and l.kind = 'related'
    where l.from_id is null
       or (l.status = 'suggested' and (l.judged_at is null or l.judged_at < greatest(a.updated_at, b.updated_at)))
    order by p.dist
    limit ${limit}`) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    a: toIdea({ id: r.a_id as number, title: String(r.a_title), summary: r.a_summary as string | null, timeline: r.a_timeline }),
    b: toIdea({ id: r.b_id as number, title: String(r.b_title), summary: r.b_summary as string | null, timeline: r.b_timeline }),
  }));
}

// Each visible tip meets its nearest NEIGHBOURS_PER_ITEM visible ideas. Hidden tips (maybes, dismissed, composted;
// HIDDEN_TIP_STATUSES, decision 025) are never judged, so they can never surface as a backlink.
export async function recIdeaCandidates(limit: number): Promise<RecIdeaCandidate[]> {
  const rows = (await db()`
    with vis as (
      select id, title, summary, timeline, centroid, updated_at from idea_clusters
      where stage <> 'dismissed' and mention_count > 0 and centroid is not null
    ), near as (
      select r.id as rec_id, r.type, r.canonical_name, r.creator, r.context_summary, r.updated_at as rec_updated_at,
             n.id as idea_id, n.dist
      from recommendations r cross join lateral (
        select c.id, r.embedding <=> c.centroid as dist from vis c
        order by r.embedding <=> c.centroid limit ${NEIGHBOURS_PER_ITEM}
      ) n
      where r.embedding is not null and r.status <> all(${HIDDEN_TIP_STATUSES}::text[]) and n.dist < ${REC_IDEA_MAX_DISTANCE}
    )
    select n.rec_id, n.type, n.canonical_name, n.creator, n.context_summary,
           c.id as idea_id, c.title, c.summary, c.timeline
    from near n join vis c on c.id = n.idea_id
    left join links l on l.from_type = 'rec' and l.from_id = n.rec_id::text and l.to_type = 'idea' and l.to_id = c.id::text
      and l.kind = 'fits'
    where l.from_id is null
       or (l.status = 'suggested' and (l.judged_at is null or l.judged_at < greatest(n.rec_updated_at, c.updated_at)))
    order by n.dist
    limit ${limit}`) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    rec: { id: Number(r.rec_id), type: String(r.type), name: String(r.canonical_name), creator: r.creator as string | null, contextSummary: r.context_summary as string | null },
    idea: toIdea({ id: r.idea_id as number, title: String(r.title), summary: r.summary as string | null, timeline: r.timeline }),
  }));
}
