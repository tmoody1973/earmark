// The Postgres half of `pnpm forget` (M3-T11, decision 011): what an item's rows and outside refs are (readPlan) and
// deleting them (deleteRows), always inside the caller's transaction. Ids and counts only, never text.
import type { PoolClient } from "@neondatabase/serverless";
import { lineIndexFor, TimelineAmbiguousError, type StampedEntry } from "../ideas/timeline-match";
import { CLAIM_LEASE } from "../store/conversations";

export type ForgetTarget = { type: "rec" | "idea" | "mention"; id: number };
export interface ForgetRefs { beeTodoIds: number[]; beeFactIds: number[]; notionPageIds: string[]; blobUrls: string[] }
export interface ForgetPlan {
  target: ForgetTarget;
  resolved: ForgetTarget; // the idea, when no other non-dismissed mention would be left
  exists: boolean;
  deletes: Record<string, number>; // rows removed per table (cascades included)
  updates: Record<string, number>; // rows recomputed per table
  refs: ForgetRefs;
  recommender: { id: number; firstName: string; removed: boolean } | null; // firstName is for hooks only, never printed
  savedAt: Date | null; // when the item first entered Earmark (for hooks: nothing made before it can hold it), never printed
  notes: string[]; // dry-run warnings (ids only)
  retitle?: boolean; // the forgotten mention is the one the idea's title came from
  draftInFlight?: number; // id of an idea whose one-pager draft claim is inside its lease: --yes refuses
  mergedInto?: number; // the idea was merged into this one and the merge can still be undone: --yes refuses
}

// A forgotten mention's timeline line could not be found: rather than leave it behind, the transaction fails.
export class ForgetTimelineError extends Error {
  override name = "ForgetTimelineError";
}

export const UNTITLED = "Untitled idea";
const TITLE_NOTE = "title came from this mention: forget the whole idea, or it will be retitled";
const TIMELINE_NOTE = "the dry run cannot check this mention's timeline line; --yes stops safely (nothing deleted) if it is missing";
const draftNote = (id: number) => `a draft is being written for idea ${id} now: --yes will refuse; retry in a few minutes`;
// The idea row (locked when executing) and whether a drafter holds a live claim on it (one-pager claim, migration 009).
// saved_at: the idea's or any of its mentions' first save (a merge can move in mentions older than the idea row).
const IDEA_ROW = `select bee_fact_id, notion_page_id,
    least(created_at, (select min(m.created_at) from idea_mentions m where m.cluster_id = idea_clusters.id)) as saved_at,
    (draft_claimed_at is not null and draft_claimed_at >= now() - interval '${CLAIM_LEASE}') as drafting
  from idea_clusters where id = $1`;
const NONE: ForgetRefs = { beeTodoIds: [], beeFactIds: [], notionPageIds: [], blobUrls: [] };
const nums = (vs: unknown[]) => [...new Set(vs.filter((v) => v != null).map(Number))];
const strs = (vs: unknown[]) => [...new Set(vs.filter((v) => v != null).map(String))];
const missing = (target: ForgetTarget, resolved = target): ForgetPlan =>
  ({ target, resolved, exists: false, deletes: {}, updates: {}, refs: NONE, recommender: null, savedAt: null, notes: [] });

async function rows(c: PoolClient, text: string, values: unknown[]): Promise<Record<string, unknown>[]> {
  return (await c.query(text, values)).rows;
}
async function count(c: PoolClient, from: string, values: unknown[]): Promise<number> {
  return Number((await rows(c, `select count(*)::int as n from ${from}`, values))[0]!.n);
}

// links/space_items/bee_sync have no foreign keys, so they are matched by (type, id) and deleted explicitly.
const LINKS = `links where (from_type = $1 and from_id = $2) or (to_type = $1 and to_id = $2)`;
const RECOMMENDER_LINKS = `links where (from_type = 'recommender' and from_id = $1) or (to_type = 'recommender' and to_id = $1)`;
// fact_proposals (M5, lane C): 'taste' evidence = rec ids, 'idea' evidence = idea ids. A proposal is model text built
// from its evidence, so it goes (with its Bee fact) when any of its evidence is forgotten.
// evidence_ids hold numbers (lane C writes Number(id): origin/m5-extras agent/lib/facts/proposals.ts:73, :103).
const PROPOSALS = `fact_proposals where kind = $1 and evidence_ids @> $2::jsonb`;
const proposalKey = (type: "rec" | "idea", id: number) => [type === "rec" ? "taste" : "idea", JSON.stringify([id])];
// Lane C maps each proposal's Bee fact in bee_sync (entity_type 'fact_proposal'; m5-extras proposals.ts:188).
const PROPOSAL_SYNC = `bee_sync where entity_type = 'fact_proposal' and entity_id = any($1::bigint[])`;
async function deleteProposals(c: PoolClient, type: "rec" | "idea", id: number): Promise<void> {
  const gone = await rows(c, `delete from ${PROPOSALS} returning id`, proposalKey(type, id));
  if (gone.length) await c.query(`delete from ${PROPOSAL_SYNC}`, [gone.map((r) => Number(r.id))]);
}
// idea_merges (M4-T6, decision 027): a merge records which mentions moved. Any forget touching a merge (a moved
// mention, or either idea) deletes the record, which ends that merge's undo. Ids and stage/count/pin only, no text.
const MERGES = `idea_merges where $1 = keep_id or $1 = merged_id`;
const MERGES_OF_MENTION = `idea_merges where $2 = any(mention_ids) or $1 = keep_id or $1 = merged_id`;
const mergedNote = (id: number, keep: number) => `idea ${id} was merged into ${keep}: undo the merge or forget ${keep}`;

async function shared(c: PoolClient, type: "rec" | "idea", id: number) {
  const sync = await rows(c, `select bee_object, bee_id from bee_sync where entity_type = $1 and entity_id = $2`, [type, id]);
  const proposals = await rows(c, `select id, bee_fact_id from ${PROPOSALS}`, proposalKey(type, id));
  const proposalSync = proposals.length ? await count(c, PROPOSAL_SYNC, [proposals.map((r) => Number(r.id))]) : 0;
  return {
    links: await count(c, LINKS, [type, String(id)]),
    space_items: await count(c, `space_items where item_type = $1 and item_id = $2`, [type, id]),
    bee_sync: sync.length + proposalSync,
    fact_proposals: proposals.length,
    todos: sync.filter((r) => r.bee_object === "todo").map((r) => r.bee_id),
    facts: [...sync.filter((r) => r.bee_object === "fact").map((r) => r.bee_id), ...proposals.map((r) => r.bee_fact_id)],
  };
}

async function planRec(c: PoolClient, target: ForgetTarget, lock: string): Promise<ForgetPlan> {
  const [r] = await rows(c, `
    select r.bee_todo_id, r.notion_page_id, r.recommender_id, p.first_name, r.created_at as saved_at,
           (select count(*)::int from recommendations o where o.recommender_id = r.recommender_id and o.id <> r.id) as others
    from recommendations r left join recommenders p on p.id = r.recommender_id where r.id = $1${lock}`, [target.id]);
  if (!r) return missing(target);
  const receipts = await rows(c, `select bee_todo_id from rec_receipts where recommendation_id = $1`, [target.id]);
  const photos = await rows(c, `select thumbnail_url from photos where recommendation_id = $1`, [target.id]);
  const s = await shared(c, "rec", target.id);
  const recommender = r.recommender_id == null ? null
    : { id: Number(r.recommender_id), firstName: String(r.first_name), removed: Number(r.others) === 0 };
  // The recommender's first name was kept for their recs only: it goes with their last one (and its links).
  const links = recommender?.removed
    ? await count(c, `links where (from_type = 'rec' and from_id = $1) or (to_type = 'rec' and to_id = $1)
                        or (from_type = 'recommender' and from_id = $2) or (to_type = 'recommender' and to_id = $2)`,
      [String(target.id), String(recommender.id)])
    : s.links;
  return {
    target, resolved: target, exists: true, recommender, savedAt: new Date(r.saved_at as Date), notes: [],
    deletes: {
      recommendations: 1, rec_receipts: receipts.length, photos: photos.length, links, space_items: s.space_items,
      bee_sync: s.bee_sync, fact_proposals: s.fact_proposals,
      resort_backup: await count(c, `resort_backup where table_name = 'recommendations' and row_id = $1`, [target.id]),
      recommenders: recommender?.removed ? 1 : 0,
    },
    updates: recommender && !recommender.removed ? { recommenders: 1 } : {},
    refs: {
      beeTodoIds: nums([r.bee_todo_id, ...s.todos, ...receipts.map((x) => x.bee_todo_id)]),
      beeFactIds: nums(s.facts),
      notionPageIds: strs([r.notion_page_id]),
      blobUrls: strs(photos.map((x) => x.thumbnail_url)),
    },
  };
}

async function planIdea(c: PoolClient, target: ForgetTarget, resolved: ForgetTarget, lock: string): Promise<ForgetPlan> {
  const [k] = await rows(c, `${IDEA_ROW}${lock}`, [resolved.id]);
  if (!k) return missing(target, resolved);
  const s = await shared(c, "idea", resolved.id);
  const [into] = await rows(c, `select keep_id from idea_merges where merged_id = $1 and undone_at is null order by id desc limit 1`, [resolved.id]);
  const mergedInto = into ? Number(into.keep_id) : undefined;
  return {
    target, resolved, exists: true, recommender: null, savedAt: new Date(k.saved_at as Date), updates: {},
    notes: [...(k.drafting ? [draftNote(resolved.id)] : []), ...(mergedInto !== undefined ? [mergedNote(resolved.id, mergedInto)] : [])],
    draftInFlight: k.drafting ? resolved.id : undefined, mergedInto,
    deletes: {
      idea_clusters: 1, idea_merges: await count(c, MERGES, [resolved.id]),
      idea_mentions: await count(c, `idea_mentions where cluster_id = $1`, [resolved.id]),
      garden_events: await count(c, `garden_events where cluster_id = $1`, [resolved.id]),
      links: s.links, space_items: s.space_items, bee_sync: s.bee_sync, fact_proposals: s.fact_proposals,
      resort_backup: await count(c, `resort_backup where (table_name = 'idea_clusters' and row_id = $1)
        or (table_name = 'idea_mentions' and row_id in (select id from idea_mentions where cluster_id = $1))`, [resolved.id]),
    },
    refs: { ...NONE, beeTodoIds: nums(s.todos), beeFactIds: nums([k.bee_fact_id, ...s.facts]), notionPageIds: strs([k.notion_page_id]) },
  };
}

// A mention leaves its idea. Everything derived from the idea's mentions goes too (summary, draft, its Bee fact, Notion
// page, fact proposals; M3-T1/T7 recreate them). When no other non-dismissed mention would be left, the whole idea is
// forgotten, dismissed mentions included (they hold excerpts too).
async function planMention(c: PoolClient, target: ForgetTarget, lock: string): Promise<ForgetPlan> {
  const [m] = await rows(c, `select cluster_id, created_at from idea_mentions where id = $1`, [target.id]);
  if (!m) return missing(target);
  const clusterId = Number(m.cluster_id);
  const [k] = await rows(c, `${IDEA_ROW}${lock}`, [clusterId]);
  const others = await count(c, `idea_mentions where cluster_id = $1 and id <> $2 and review_status <> 'dismissed'`, [clusterId, target.id]);
  if (!k || others === 0) return planIdea(c, target, { type: "idea", id: clusterId }, lock);
  // The title is the creating mention's extraction (save-item.ts create path): the cluster's first saved mention.
  const [first] = await rows(c, `select min(id) as id from idea_mentions where cluster_id = $1`, [clusterId]);
  const retitle = Number(first!.id) === target.id;
  const s = await shared(c, "idea", clusterId);
  return {
    target, resolved: target, exists: true, recommender: null, savedAt: new Date(m.created_at as Date), retitle,
    notes: [...(retitle ? [TITLE_NOTE] : []), TIMELINE_NOTE, ...(k.drafting ? [draftNote(clusterId)] : [])],
    draftInFlight: k.drafting ? clusterId : undefined,
    deletes: {
      idea_mentions: 1, bee_sync: s.bee_sync, fact_proposals: s.fact_proposals,
      idea_merges: await count(c, MERGES_OF_MENTION, [clusterId, target.id]),
      resort_backup: await count(c, `resort_backup where table_name = 'idea_mentions' and row_id = $1`, [target.id]),
    },
    updates: { idea_clusters: 1 },
    refs: { ...NONE, beeTodoIds: nums(s.todos), beeFactIds: nums([k.bee_fact_id, ...s.facts]), notionPageIds: strs([k.notion_page_id]) },
  };
}

export async function readPlan(c: PoolClient, target: ForgetTarget, lock: boolean): Promise<ForgetPlan> {
  const forUpdate = lock ? " for update" : "";
  if (target.type === "rec") return planRec(c, target, lock ? " for update of r" : "");
  if (target.type === "idea") return planIdea(c, target, target, forUpdate);
  return planMention(c, target, forUpdate);
}

// Deletes everything readPlan counted. Returns log lines (ids only).
export async function deleteRows(c: PoolClient, plan: ForgetPlan): Promise<string[]> {
  const { type, id } = plan.resolved;
  if (type === "mention") return deleteMention(c, id, plan.retitle === true);
  await c.query(`delete from ${LINKS}`, [type, String(id)]);
  await c.query(`delete from space_items where item_type = $1 and item_id = $2`, [type, id]);
  await c.query(`delete from bee_sync where entity_type = $1 and entity_id = $2`, [type, id]);
  await deleteProposals(c, type, id);
  if (type === "idea") {
    await c.query(`delete from resort_backup where (table_name = 'idea_clusters' and row_id = $1)
      or (table_name = 'idea_mentions' and row_id in (select id from idea_mentions where cluster_id = $1))`, [id]);
    await c.query(`delete from idea_clusters where id = $1`, [id]); // mentions, garden events and merges cascade
    return [];
  }
  await c.query(`delete from resort_backup where table_name = 'recommendations' and row_id = $1`, [id]);
  await c.query(`delete from recommendations where id = $1`, [id]); // receipts and photos cascade
  const p = plan.recommender;
  if (p?.removed) {
    await c.query(`delete from ${RECOMMENDER_LINKS}`, [String(p.id)]);
    await c.query(`delete from recommenders where id = $1`, [p.id]);
  } else if (p) {
    // Same recipe as recomputeRecommender (recs/status.ts), inline because it must run on this transaction's client.
    await c.query(`update recommenders p set
        recs_given = (select count(*) from recommendations r where r.recommender_id = p.id),
        recs_tried = (select count(*) from recommendations r where r.recommender_id = p.id and r.status in ('tried', 'thanked')),
        recs_loved = (select count(*) from recommendations r where r.recommender_id = p.id and r.rating = 'loved')
      where p.id = $1`, [p.id]);
  }
  return [];
}

// Drops the mention, its backup row and its timeline line (by mention_id; legacy lines by a unique spoken_at), then
// recomputes the idea as the save path keeps it (count and centroid over non-dismissed mentions, decision 004) and
// clears what was derived from all its mentions: summary, draft (a drafted idea re-drafts), Bee fact and Notion page
// ids (deleted outside already), fact proposals. Titles are not stored per mention, so a title from this mention
// becomes a placeholder.
async function deleteMention(c: PoolClient, id: number, retitle: boolean): Promise<string[]> {
  await c.query(`delete from resort_backup where table_name = 'idea_mentions' and row_id = $1`, [id]);
  const [m] = await rows(c, `delete from idea_mentions where id = $1 returning cluster_id, spoken_at`, [id]);
  if (!m) return [];
  const clusterId = Number(m.cluster_id);
  await c.query(`delete from ${MERGES_OF_MENTION}`, [clusterId, id]);
  const [k] = await rows(c, `select timeline from idea_clusters where id = $1`, [clusterId]);
  const timeline = (k?.timeline ?? []) as StampedEntry[];
  let at: number;
  try {
    at = lineIndexFor(timeline, { id, spokenAt: m.spoken_at as string | Date }, clusterId); // by mention id (M4-T6)
  } catch (err) {
    if (err instanceof TimelineAmbiguousError) throw new ForgetTimelineError(err.message);
    throw err;
  }
  if (at === -1) throw new ForgetTimelineError(`idea ${clusterId} has no timeline line for mention ${id}; forget the whole idea instead`);
  const kept = [...timeline.slice(0, at), ...timeline.slice(at + 1)];
  await c.query(`delete from bee_sync where entity_type = 'idea' and entity_id = $1`, [clusterId]);
  await deleteProposals(c, "idea", clusterId);
  await c.query(`
    update idea_clusters c set
      mention_count = s.n,
      stage = idea_stage_for(case when c.stage = 'drafted' then 'compost' else c.stage end, s.n),
      centroid = s.centroid, first_mentioned_at = s.first, last_mentioned_at = s.last, timeline = $2::jsonb,
      title = case when $3::boolean then $4 else c.title end,
      summary = null, draft_md = null, draft_format = null, draft_claimed_at = null, draft_attempts = 0,
      bee_fact_id = null, notion_page_id = null, updated_at = now()
    from (
      select count(*) filter (where review_status <> 'dismissed')::int as n, min(spoken_at) as first, max(spoken_at) as last,
             avg(embedding) filter (where review_status <> 'dismissed' and embedding is not null) as centroid
      from idea_mentions where cluster_id = $1
    ) s
    where c.id = $1`, [clusterId, JSON.stringify(kept), retitle, UNTITLED]);
  return retitle ? [`retitled idea ${clusterId} to "${UNTITLED}" (titles are not stored per mention)`] : [];
}
