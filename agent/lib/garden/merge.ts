import { randomUUID } from "node:crypto";
import { db } from "../db";
import { gardenReadOnly } from "../e2e-guard";

// Merging two ideas that are one idea (decision 027). Reversible: an idea_merges row records which mentions moved and
// each idea's stage, count and pin (no text), and undoMerge puts them back. Nothing is deleted: the merged idea stays
// (dismissed, with a "merged into" note and Undo on its page), and a mention from the same conversation as one of the
// kept idea's stays with the merged idea (the per-idea occasion indexes, migrations 004/006, allow one per conversation).
//
// Timeline lines travel with their mentions, never by their text: a line belongs to the mention spoken at its date
// (timelineEntryJson writes the mention's spoken_at; forget pairs them the same way). Per date, a merge moves as many
// lines as mentions moved at that date, the earliest first; undo takes back the same number, the latest first (the
// ones the merge appended), so a kept idea's own identical lines never move.
//
// One non-interactive transaction. The first statement inserts the merge row only when both ideas are still growing;
// every later statement acts only through that row (by its random token), so a refused merge changes nothing.
// Stage follows idea_stage_for (= stageFor): a merge that brings an idea to its third mention blooms it (a 'bloom'
// garden event; the draft job writes the one-pager), exactly as a third mention would.

/** Merge `mergedId` into `keepId`. Returns the merge id (for Undo), or null when nothing changed. */
export async function mergeClusters(keepId: number, mergedId: number): Promise<number | null> {
  if (keepId === mergedId) throw new Error("Cannot merge an idea into itself");
  if (gardenReadOnly()) return null; // a real-data e2e run browses read-only (e2e-guard.ts)
  const sql = db();
  const token = randomUUID();
  const lo = String(Math.min(keepId, mergedId));
  const hi = String(Math.max(keepId, mergedId));
  const [recorded] = (await sql.transaction([
    sql`
      with k as (select * from idea_clusters where id = ${keepId} and stage <> 'dismissed' for update),
           m as (select * from idea_clusters where id = ${mergedId} and stage <> 'dismissed' for update),
           moving as (
             select mm.id from idea_mentions mm, m
             where mm.cluster_id = m.id
               and not exists (
                 select 1 from idea_mentions km where km.cluster_id = ${keepId} and (
                   km.bee_conversation_id = mm.bee_conversation_id or km.bee_conversation_uuid = mm.bee_conversation_uuid
                   or km.bee_journal_id = mm.bee_journal_id)))
      insert into idea_merges (token, keep_id, merged_id, mention_ids, keep_before, merged_before)
      select ${token}::uuid, k.id, m.id, coalesce((select array_agg(id order by id) from moving), '{}'),
        jsonb_build_object('stage', k.stage, 'mention_count', k.mention_count, 'pinned', k.pinned),
        jsonb_build_object('stage', m.stage, 'mention_count', m.mention_count, 'pinned', m.pinned)
      from k, m
      returning id`,
    sql`update idea_mentions set cluster_id = ${keepId}
        where id in (select unnest(mention_ids) from idea_merges where token = ${token}::uuid) and cluster_id = ${mergedId}`,
    // Both ideas in one statement (different rows): the moved lines go from the merged idea to the kept one.
    // counted = non-dismissed mentions (save-item.ts: accepted and needs_review both count, decision 004)
    sql`
      with mg as (select * from idea_merges where token = ${token}::uuid),
           moved as (select id, spoken_at, review_status from idea_mentions where id in (select unnest(mention_ids) from mg)),
           n as (select count(*) filter (where review_status <> 'dismissed')::int as n from moved),
           per_date as (select spoken_at, count(*) as n from moved group by spoken_at),
           lines as (
             select t.e, t.ord, row_number() over (partition by (t.e ->> 'date')::timestamptz order by t.ord) as rk
             from idea_clusters m, jsonb_array_elements(m.timeline) with ordinality as t(e, ord)
             where m.id = (select merged_id from mg)),
           going as (select l.e, l.ord from lines l join per_date p on p.spoken_at = (l.e ->> 'date')::timestamptz and l.rk <= p.n),
           k as (
             update idea_clusters k set
               mention_count = k.mention_count + n.n,
               stage = idea_stage_for(k.stage, k.mention_count + n.n),
               centroid = coalesce((select avg(embedding) from idea_mentions where cluster_id = k.id and review_status <> 'dismissed' and embedding is not null), k.centroid),
               first_mentioned_at = (select min(spoken_at) from idea_mentions where cluster_id = k.id),
               last_mentioned_at = (select max(spoken_at) from idea_mentions where cluster_id = k.id),
               timeline = coalesce(k.timeline, '[]'::jsonb) || coalesce((select jsonb_agg(e order by ord) from going), '[]'::jsonb),
               pinned = k.pinned or (mg.merged_before ->> 'pinned')::boolean,
               updated_at = now()
             from mg, n where k.id = mg.keep_id
             returning old.stage as prev_stage, new.stage as next_stage, k.id),
           m as (
             update idea_clusters m set
               stage = 'dismissed',
               mention_count = m.mention_count - n.n,
               centroid = coalesce((select avg(embedding) from idea_mentions where cluster_id = m.id and review_status <> 'dismissed' and embedding is not null), m.centroid),
               timeline = coalesce((select jsonb_agg(l.e order by l.ord) from lines l where l.ord not in (select ord from going)), '[]'::jsonb),
               updated_at = now()
             from mg, n where m.id = mg.merged_id
             returning m.id)
      insert into garden_events (kind, cluster_id)
      select 'bloom', k.id from k where k.prev_stage <> 'ready' and k.next_stage = 'ready'`,
    sql`
      update links set status = 'accepted'
      where kind = 'merge_suggestion' and from_type = 'idea' and to_type = 'idea' and from_id = ${lo} and to_id = ${hi}
        and exists (select 1 from idea_merges where token = ${token}::uuid)`,
  ])) as Array<Array<{ id: number | string }>>;
  return recorded && recorded.length > 0 ? Number(recorded[0]!.id) : null;
}

/**
 * Undo one merge: the moved mentions and their timeline lines go back, both ideas get their stage and pin back, counts
 * and centroids are recounted, and the "same idea" suggestion is marked removed so it is not offered again.
 * A bloom the merge caused is taken back with what grew from it: if the kept idea was below bloom before the merge,
 * its summary and one-pager (written from mentions that are leaving) are cleared and its stage follows the count, the
 * way forget recomputes an idea. False (nothing changed) if already undone, if the kept idea was itself merged on or
 * dismissed since, or if any moved mention no longer exists (a forget ended this merge).
 */
export async function undoMerge(mergeId: number): Promise<boolean> {
  if (gardenReadOnly()) return false;
  const sql = db();
  // now() is the transaction's start time: `undone_at = now()` in later statements means "claimed by this transaction".
  const [claimed] = (await sql.transaction([
    sql`update idea_merges mg set undone_at = now() where mg.id = ${mergeId} and mg.undone_at is null
          and exists (select 1 from idea_clusters k where k.id = mg.keep_id and k.stage <> 'dismissed')
          and cardinality(mg.mention_ids) = (select count(*) from idea_mentions where id = any(mg.mention_ids))
        returning mg.id`,
    sql`update idea_mentions mm set cluster_id = mg.merged_id
        from idea_merges mg where mg.id = ${mergeId} and mg.undone_at = now()
          and mm.id = any(mg.mention_ids) and mm.cluster_id = mg.keep_id`,
    sql`
      with mg as (select * from idea_merges where id = ${mergeId} and undone_at = now()),
           moved as (select id, spoken_at, review_status from idea_mentions where id in (select unnest(mention_ids) from mg)),
           n as (select count(*) filter (where review_status <> 'dismissed')::int as n from moved),
           per_date as (select spoken_at, count(*) as n from moved group by spoken_at),
           lines as (
             select t.e, t.ord, row_number() over (partition by (t.e ->> 'date')::timestamptz order by t.ord desc) as rk
             from idea_clusters k, jsonb_array_elements(k.timeline) with ordinality as t(e, ord)
             where k.id = (select keep_id from mg)),
           going as (select l.e, l.ord from lines l join per_date p on p.spoken_at = (l.e ->> 'date')::timestamptz and l.rk <= p.n),
           k as (
             update idea_clusters k set
               mention_count = k.mention_count - n.n,
               stage = case
                 when k.stage in ('used', 'dismissed') then k.stage
                 when mg.keep_before ->> 'stage' in ('compost', 'sprouting')
                   then idea_stage_for(case when k.stage in ('ready', 'drafted') then 'compost' else k.stage end, k.mention_count - n.n)
                 else k.stage end,
               summary = case when mg.keep_before ->> 'stage' in ('compost', 'sprouting') and k.stage in ('ready', 'drafted') then null else k.summary end,
               draft_md = case when mg.keep_before ->> 'stage' in ('compost', 'sprouting') and k.stage in ('ready', 'drafted') then null else k.draft_md end,
               draft_format = case when mg.keep_before ->> 'stage' in ('compost', 'sprouting') and k.stage in ('ready', 'drafted') then null else k.draft_format end,
               draft_claimed_at = case when mg.keep_before ->> 'stage' in ('compost', 'sprouting') and k.stage in ('ready', 'drafted') then null else k.draft_claimed_at end,
               draft_attempts = case when mg.keep_before ->> 'stage' in ('compost', 'sprouting') and k.stage in ('ready', 'drafted') then 0 else k.draft_attempts end,
               centroid = coalesce((select avg(embedding) from idea_mentions where cluster_id = k.id and review_status <> 'dismissed' and embedding is not null), k.centroid),
               first_mentioned_at = coalesce((select min(spoken_at) from idea_mentions where cluster_id = k.id), k.first_mentioned_at),
               last_mentioned_at = coalesce((select max(spoken_at) from idea_mentions where cluster_id = k.id), k.last_mentioned_at),
               timeline = coalesce((select jsonb_agg(l.e order by l.ord) from lines l where l.ord not in (select ord from going)), '[]'::jsonb),
               pinned = (mg.keep_before ->> 'pinned')::boolean,
               updated_at = now()
             from mg, n where k.id = mg.keep_id
             returning k.id)
      update idea_clusters m set
        stage = case when m.stage = 'dismissed' then mg.merged_before ->> 'stage' else m.stage end,
        mention_count = m.mention_count + n.n,
        centroid = coalesce((select avg(embedding) from idea_mentions where cluster_id = m.id and review_status <> 'dismissed' and embedding is not null), m.centroid),
        timeline = coalesce(m.timeline, '[]'::jsonb) || coalesce((select jsonb_agg(e order by ord) from going), '[]'::jsonb),
        updated_at = now()
      from mg, n where m.id = mg.merged_id`,
    // the merge's bloom no longer happened, unless the idea is still in bloom on its own
    sql`
      delete from garden_events e using idea_merges mg, idea_clusters k
      where mg.id = ${mergeId} and mg.undone_at = now() and e.cluster_id = mg.keep_id and k.id = mg.keep_id
        and e.kind = 'bloom' and e.created_at >= mg.merged_at and k.stage not in ('ready', 'drafted', 'used')`,
    sql`
      update links l set status = 'removed'
      from idea_merges mg
      where mg.id = ${mergeId} and mg.undone_at = now() and l.kind = 'merge_suggestion' and l.from_type = 'idea' and l.to_type = 'idea'
        and l.from_id = least(mg.keep_id, mg.merged_id)::text and l.to_id = greatest(mg.keep_id, mg.merged_id)::text`,
  ])) as Array<unknown[]>;
  return !!claimed && claimed.length > 0;
}
