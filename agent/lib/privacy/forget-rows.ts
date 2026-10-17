// The Postgres half of `pnpm forget` (M3-T11, decision 011): what an item's rows and outside refs are (readPlan) and
// deleting them (deleteRows), always inside the caller's transaction. Ids and counts only, never text.
import type { PoolClient } from "@neondatabase/serverless";

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
  notes: string[]; // dry-run warnings (ids only)
  retitle?: boolean; // the forgotten mention is the one the idea's title came from
}

// A forgotten mention's timeline line could not be found: rather than leave it behind, the transaction fails.
export class ForgetTimelineError extends Error {
  override name = "ForgetTimelineError";
}

export const UNTITLED = "Untitled idea";
const TITLE_NOTE = "title came from this mention: forget the whole idea, or it will be retitled";
const NONE: ForgetRefs = { beeTodoIds: [], beeFactIds: [], notionPageIds: [], blobUrls: [] };
const nums = (vs: unknown[]) => [...new Set(vs.filter((v) => v != null).map(Number))];
const strs = (vs: unknown[]) => [...new Set(vs.filter((v) => v != null).map(String))];
const missing = (target: ForgetTarget, resolved = target): ForgetPlan =>
  ({ target, resolved, exists: false, deletes: {}, updates: {}, refs: NONE, recommender: null, notes: [] });

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
const PROPOSALS = `fact_proposals where kind = $1 and evidence_ids @> $2::jsonb`;
const proposalKey = (type: "rec" | "idea", id: number) => [type === "rec" ? "taste" : "idea", JSON.stringify([id])];

async function shared(c: PoolClient, type: "rec" | "idea", id: number) {
  const sync = await rows(c, `select bee_object, bee_id from bee_sync where entity_type = $1 and entity_id = $2`, [type, id]);
  const proposals = await rows(c, `select bee_fact_id from ${PROPOSALS}`, proposalKey(type, id));
  return {
    links: await count(c, LINKS, [type, String(id)]),
    space_items: await count(c, `space_items where item_type = $1 and item_id = $2`, [type, id]),
    bee_sync: sync.length,
    fact_proposals: proposals.length,
    todos: sync.filter((r) => r.bee_object === "todo").map((r) => r.bee_id),
    facts: [...sync.filter((r) => r.bee_object === "fact").map((r) => r.bee_id), ...proposals.map((r) => r.bee_fact_id)],
  };
}

async function planRec(c: PoolClient, target: ForgetTarget, lock: string): Promise<ForgetPlan> {
  const [r] = await rows(c, `
    select r.bee_todo_id, r.notion_page_id, r.recommender_id, p.first_name,
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
    target, resolved: target, exists: true, recommender, notes: [],
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
  const [k] = await rows(c, `select bee_fact_id, notion_page_id from idea_clusters where id = $1${lock}`, [resolved.id]);
  if (!k) return missing(target, resolved);
  const s = await shared(c, "idea", resolved.id);
  return {
    target, resolved, exists: true, recommender: null, updates: {}, notes: [],
    deletes: {
      idea_clusters: 1,
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
  const [m] = await rows(c, `select cluster_id from idea_mentions where id = $1`, [target.id]);
  if (!m) return missing(target);
  const clusterId = Number(m.cluster_id);
  const [k] = await rows(c, `select bee_fact_id, notion_page_id from idea_clusters where id = $1${lock}`, [clusterId]);
  const others = await count(c, `idea_mentions where cluster_id = $1 and id <> $2 and review_status <> 'dismissed'`, [clusterId, target.id]);
  if (!k || others === 0) return planIdea(c, target, { type: "idea", id: clusterId }, lock);
  // The title is the creating mention's extraction (save-item.ts create path): the cluster's first saved mention.
  const [first] = await rows(c, `select min(id) as id from idea_mentions where cluster_id = $1`, [clusterId]);
  const retitle = Number(first!.id) === target.id;
  const s = await shared(c, "idea", clusterId);
  return {
    target, resolved: target, exists: true, recommender: null, retitle, notes: retitle ? [TITLE_NOTE] : [],
    deletes: {
      idea_mentions: 1, bee_sync: s.bee_sync, fact_proposals: s.fact_proposals,
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
  await c.query(`delete from ${PROPOSALS}`, proposalKey(type, id));
  if (type === "idea") {
    await c.query(`delete from resort_backup where (table_name = 'idea_clusters' and row_id = $1)
      or (table_name = 'idea_mentions' and row_id in (select id from idea_mentions where cluster_id = $1))`, [id]);
    await c.query(`delete from idea_clusters where id = $1`, [id]); // mentions and garden events cascade
    return [];
  }
  await c.query(`delete from resort_backup where table_name = 'recommendations' and row_id = $1`, [id]);
  await c.query(`delete from recommendations where id = $1`, [id]); // receipts and photos cascade
  const p = plan.recommender;
  if (p?.removed) {
    await c.query(`delete from ${RECOMMENDER_LINKS}`, [String(p.id)]);
    await c.query(`delete from recommenders where id = $1`, [p.id]);
  } else if (p) {
    // ponytail: inline recount until M3-T2's recomputeRecommender exists; recs_given = every rec, as the insert path counts.
    await c.query(`update recommenders p set
        recs_given = (select count(*) from recommendations r where r.recommender_id = p.id),
        recs_tried = (select count(*) from recommendations r where r.recommender_id = p.id and r.status in ('tried', 'thanked')),
        recs_loved = (select count(*) from recommendations r where r.recommender_id = p.id and r.rating = 'loved')
      where p.id = $1`, [p.id]);
  }
  return [];
}

// Drops the mention, its backup row and its timeline line (paired by spoken_at, as timelineEntryJson writes it), then
// recomputes the idea as the save path keeps it (count and centroid over non-dismissed mentions, decision 004) and
// clears what was derived from all its mentions: summary, draft (a drafted idea re-drafts), Bee fact and Notion page
// ids (deleted outside already), fact proposals. Titles are not stored per mention, so a title from this mention
// becomes a placeholder.
async function deleteMention(c: PoolClient, id: number, retitle: boolean): Promise<string[]> {
  await c.query(`delete from resort_backup where table_name = 'idea_mentions' and row_id = $1`, [id]);
  const [m] = await rows(c, `delete from idea_mentions where id = $1 returning cluster_id, spoken_at`, [id]);
  if (!m) return [];
  const clusterId = Number(m.cluster_id);
  const spokenAt = new Date(m.spoken_at as string | Date).getTime();
  const [k] = await rows(c, `select timeline from idea_clusters where id = $1`, [clusterId]);
  const timeline = (k?.timeline ?? []) as { date: string }[];
  const at = timeline.findIndex((e) => Date.parse(e.date) === spokenAt);
  if (at === -1) throw new ForgetTimelineError(`idea ${clusterId} has no timeline line for mention ${id}; forget the whole idea instead`);
  const kept = [...timeline.slice(0, at), ...timeline.slice(at + 1)];
  await c.query(`delete from bee_sync where entity_type = 'idea' and entity_id = $1`, [clusterId]);
  await c.query(`delete from ${PROPOSALS}`, proposalKey("idea", clusterId));
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
