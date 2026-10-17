import { randomUUID } from "node:crypto";
import { db } from "../db";
import { gardenReadOnly } from "../e2e-guard";
import { lineIndexFor, TimelineAmbiguousError, type StampedEntry } from "../ideas/timeline-match";
import { hasMentionFromSameOccasion } from "../store/ideas";

// Merging two ideas that are one idea (decision 027). Reversible: an idea_merges row records which mentions moved,
// each idea's stage, count and pin, and the prior status of any twin (no text), and undoMerge puts them back.
// Nothing is deleted: the merged idea stays (dismissed, with a "merged into" note and Undo on its page).
//
// Occasions: one conversation or voice note counts once per idea. A mention whose conversation/journal id equals one
// the kept idea has cannot move (the per-idea unique indexes, migrations 004/006) and stays with the merged idea. A
// mention that is the same occasion by the save path's own rule (hasMentionFromSameOccasion: a live uuid and the REST
// id of one conversation, or a voice note inside it) moves, but dismissed, so the moment counts once.
//
// Timeline lines travel with their mentions, matched by mention_id (ideas/timeline-match.ts; legacy lines by a unique
// moment, else the merge refuses). A legacy line that moves is stamped with its mention's id on the way.
//
// Plan in code, write in one transaction. The plan is read first; the first statement records the merge only when
// both ideas are still growing and unchanged since the read (updated_at), and every later statement acts only through
// that record (by its random token), so a stale or refused plan changes nothing.

type Row = Record<string, unknown>;
interface IdeaRow { id: number; stage: string; timeline: StampedEntry[]; ver: string }
interface MentionRow { id: number; convId: number | null; uuid: string | null; journalId: string | null; spokenAt: string; status: string }

async function readIdea(id: number): Promise<IdeaRow | null> {
  const [r] = (await db()`select id, stage, timeline, updated_at::text as ver from idea_clusters where id = ${id}`) as Row[];
  return r ? { id: Number(r.id), stage: String(r.stage), timeline: (r.timeline ?? []) as StampedEntry[], ver: String(r.ver) } : null;
}
async function readMentions(sql: ReturnType<typeof db>, where: { clusterId?: number; ids?: number[] }): Promise<MentionRow[]> {
  const rows = (where.ids
    ? await sql`select id, bee_conversation_id, bee_conversation_uuid, bee_journal_id, (extract(epoch from spoken_at) * 1000)::float8 as spoken_ms, review_status
                from idea_mentions where id = any(${where.ids}::bigint[])`
    : await sql`select id, bee_conversation_id, bee_conversation_uuid, bee_journal_id, (extract(epoch from spoken_at) * 1000)::float8 as spoken_ms, review_status
                from idea_mentions where cluster_id = ${where.clusterId!} order by id`) as Row[];
  return rows.map((r) => ({
    id: Number(r.id),
    convId: r.bee_conversation_id == null ? null : Number(r.bee_conversation_id),
    uuid: (r.bee_conversation_uuid as string | null) ?? null,
    journalId: (r.bee_journal_id as string | null) ?? null,
    spokenAt: new Date(Number(r.spoken_ms)).toISOString(),
    status: String(r.review_status),
  }));
}

// Splits `from`'s timeline: the lines of `mentions` (stamped with their mention id) and the rest. Throws
// TimelineAmbiguousError when a legacy line cannot be told apart.
// byIdOnly (undo): only lines that name a moved mention; never fall back to a date in the kept idea, whose own legacy
// lines must stay put (every line a merge moves is stamped on the way, so undo never needs the date).
function splitLines(from: IdeaRow, mentions: readonly MentionRow[], { byIdOnly = false } = {}): { going: StampedEntry[]; staying: StampedEntry[] } {
  const owner = new Map<number, number>(); // line index → mention id
  for (const mm of mentions) {
    const i = byIdOnly
      ? from.timeline.findIndex((e) => e.mention_id != null && Number(e.mention_id) === mm.id)
      : lineIndexFor(from.timeline, { id: mm.id, spokenAt: mm.spokenAt }, from.id);
    if (i === -1) continue;
    // two moving mentions at one moment cannot both own a single legacy line: refuse rather than guess
    if (owner.has(i)) throw new TimelineAmbiguousError(from.id);
    owner.set(i, mm.id);
  }
  return {
    going: from.timeline.flatMap((e, i) => (owner.has(i) ? [{ ...e, mention_id: owner.get(i)! }] : [])),
    staying: from.timeline.filter((_, i) => !owner.has(i)),
  };
}

/** Merge `mergedId` into `keepId`. Returns the merge id (for Undo), or null when nothing changed. */
export async function mergeClusters(keepId: number, mergedId: number): Promise<number | null> {
  if (keepId === mergedId) throw new Error("Cannot merge an idea into itself");
  if (gardenReadOnly()) return null; // a real-data e2e run browses read-only (e2e-guard.ts)
  const sql = db();
  const [k, m] = [await readIdea(keepId), await readIdea(mergedId)];
  if (!k || !m || k.stage === "dismissed" || m.stage === "dismissed") return null;
  const kept = await readMentions(sql, { clusterId: keepId });
  const theirs = await readMentions(sql, { clusterId: mergedId });
  const sameId = (a: MentionRow, b: MentionRow) =>
    (a.convId !== null && a.convId === b.convId) || (a.uuid !== null && a.uuid === b.uuid) || (a.journalId !== null && a.journalId === b.journalId);
  const moving = theirs.filter((mm) => !kept.some((km) => sameId(km, mm)));
  const twins: Record<string, string> = {};
  for (const mm of moving) {
    if (mm.status === "dismissed") continue;
    const same = await hasMentionFromSameOccasion(keepId, {
      beeConversationId: mm.convId, beeConversationUuid: mm.uuid, beeJournalId: mm.journalId, spokenAt: new Date(mm.spokenAt),
    });
    if (same) twins[String(mm.id)] = mm.status;
  }
  const { going, staying } = splitLines(m, moving);
  const keepTimeline = JSON.stringify([...k.timeline, ...going]);
  const mergedTimeline = JSON.stringify(staying);
  const movingIds = moving.map((mm) => mm.id);
  const twinIds = Object.keys(twins).map(Number);

  const token = randomUUID();
  const lo = String(Math.min(keepId, mergedId));
  const hi = String(Math.max(keepId, mergedId));
  const [recorded] = (await sql.transaction([
    // Both ideas are row-locked first (in id order) and checked against the plan on the locked rows: a live save that
    // joins either idea waits for this transaction, or has already committed and this merge refuses (stale plan).
    sql`
      with locked as (
        select id, stage, mention_count, pinned, updated_at from idea_clusters
        where id in (${keepId}, ${mergedId}) order by id for update)
      insert into idea_merges (token, keep_id, merged_id, mention_ids, keep_before, merged_before, twin_statuses)
      select ${token}::uuid, k.id, m.id, ${movingIds}::bigint[],
        jsonb_build_object('stage', k.stage, 'mention_count', k.mention_count, 'pinned', k.pinned),
        jsonb_build_object('stage', m.stage, 'mention_count', m.mention_count, 'pinned', m.pinned),
        ${JSON.stringify(twins)}::jsonb
      from locked k, locked m
      where k.id = ${keepId} and m.id = ${mergedId} and k.stage <> 'dismissed' and m.stage <> 'dismissed'
        and k.updated_at = ${k.ver}::timestamptz and m.updated_at = ${m.ver}::timestamptz
      returning id`,
    sql`update idea_mentions set cluster_id = ${keepId},
          review_status = case when id = any(${twinIds}::bigint[]) then 'dismissed' else review_status end
        where id in (select unnest(mention_ids) from idea_merges where token = ${token}::uuid) and cluster_id = ${mergedId}`,
    // Both ideas in one statement (different rows). Counts are recounted: non-dismissed mentions (decision 004).
    sql`
      with mg as (select * from idea_merges where token = ${token}::uuid),
           k as (
             update idea_clusters k set
               mention_count = (select count(*) from idea_mentions where cluster_id = k.id and review_status <> 'dismissed'),
               stage = idea_stage_for(k.stage, (select count(*)::int from idea_mentions where cluster_id = k.id and review_status <> 'dismissed')),
               centroid = coalesce((select avg(embedding) from idea_mentions where cluster_id = k.id and review_status <> 'dismissed' and embedding is not null), k.centroid),
               first_mentioned_at = (select min(spoken_at) from idea_mentions where cluster_id = k.id),
               last_mentioned_at = (select max(spoken_at) from idea_mentions where cluster_id = k.id),
               timeline = ${keepTimeline}::jsonb,
               pinned = k.pinned or (mg.merged_before ->> 'pinned')::boolean,
               updated_at = now()
             from mg where k.id = mg.keep_id
             returning old.stage as prev_stage, new.stage as next_stage, k.id),
           m as (
             update idea_clusters m set
               stage = 'dismissed',
               mention_count = (select count(*) from idea_mentions where cluster_id = m.id and review_status <> 'dismissed'),
               centroid = coalesce((select avg(embedding) from idea_mentions where cluster_id = m.id and review_status <> 'dismissed' and embedding is not null), m.centroid),
               timeline = ${mergedTimeline}::jsonb,
               updated_at = now()
             from mg where m.id = mg.merged_id
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
 * Undo one merge: the moved mentions (twins with their prior status) and their timeline lines go back, both ideas get
 * their stage and pin back, counts and centroids are recounted, and the "same idea" suggestion is marked removed so it
 * is not offered again. A bloom the merge caused is taken back with what grew from it: if the kept idea was below bloom
 * before the merge, its summary and one-pager are cleared and its stage follows the count, the way forget recomputes
 * an idea. False (nothing changed) if already undone, if the kept idea was dismissed or merged on since, if either idea
 * changed after this read, or if any moved mention no longer exists (a forget ended this merge).
 */
export async function undoMerge(mergeId: number): Promise<boolean> {
  if (gardenReadOnly()) return false;
  const sql = db();
  const [mg] = (await sql`select keep_id, merged_id, mention_ids from idea_merges where id = ${mergeId} and undone_at is null`) as Row[];
  if (!mg) return false;
  const ids = ((mg.mention_ids ?? []) as Array<number | string>).map(Number);
  const [k, m] = [await readIdea(Number(mg.keep_id)), await readIdea(Number(mg.merged_id))];
  if (!k || !m || k.stage === "dismissed") return false;
  const moved = await readMentions(sql, { ids });
  if (moved.length !== ids.length) return false;
  const { going, staying } = splitLines(k, moved, { byIdOnly: true }); // only lines naming a moved mention
  const keepTimeline = JSON.stringify(staying);
  const mergedTimeline = JSON.stringify([...m.timeline, ...going]);

  // now() is the transaction's start time: `undone_at = now()` in later statements means "claimed by this transaction".
  const [claimed] = (await sql.transaction([
    // both ideas row-locked first (id order), the plan checked on the locked rows, as in mergeClusters
    sql`with locked as (
          select id, stage, updated_at from idea_clusters where id in (${k.id}, ${m.id}) order by id for update)
        update idea_merges mg set undone_at = now() where mg.id = ${mergeId} and mg.undone_at is null
          and exists (select 1 from locked k where k.id = mg.keep_id and k.stage <> 'dismissed' and k.updated_at = ${k.ver}::timestamptz)
          and exists (select 1 from locked m where m.id = mg.merged_id and m.updated_at = ${m.ver}::timestamptz)
          and cardinality(mg.mention_ids) = (select count(*) from idea_mentions where id = any(mg.mention_ids))
        returning mg.id`,
    sql`update idea_mentions mm set cluster_id = mg.merged_id,
          review_status = coalesce(mg.twin_statuses ->> mm.id::text, mm.review_status)
        from idea_merges mg where mg.id = ${mergeId} and mg.undone_at = now()
          and mm.id = any(mg.mention_ids) and mm.cluster_id = mg.keep_id`,
    sql`
      with mg as (select * from idea_merges where id = ${mergeId} and undone_at = now()),
           k as (
             update idea_clusters k set
               mention_count = (select count(*) from idea_mentions where cluster_id = k.id and review_status <> 'dismissed'),
               stage = case
                 when k.stage in ('used', 'dismissed') then k.stage
                 when mg.keep_before ->> 'stage' in ('compost', 'sprouting')
                   then idea_stage_for(case when k.stage in ('ready', 'drafted') then 'compost' else k.stage end,
                                       (select count(*)::int from idea_mentions where cluster_id = k.id and review_status <> 'dismissed'))
                 else k.stage end,
               summary = case when mg.keep_before ->> 'stage' in ('compost', 'sprouting') and k.stage in ('ready', 'drafted') then null else k.summary end,
               draft_md = case when mg.keep_before ->> 'stage' in ('compost', 'sprouting') and k.stage in ('ready', 'drafted') then null else k.draft_md end,
               draft_format = case when mg.keep_before ->> 'stage' in ('compost', 'sprouting') and k.stage in ('ready', 'drafted') then null else k.draft_format end,
               draft_claimed_at = case when mg.keep_before ->> 'stage' in ('compost', 'sprouting') and k.stage in ('ready', 'drafted') then null else k.draft_claimed_at end,
               draft_attempts = case when mg.keep_before ->> 'stage' in ('compost', 'sprouting') and k.stage in ('ready', 'drafted') then 0 else k.draft_attempts end,
               centroid = coalesce((select avg(embedding) from idea_mentions where cluster_id = k.id and review_status <> 'dismissed' and embedding is not null), k.centroid),
               first_mentioned_at = coalesce((select min(spoken_at) from idea_mentions where cluster_id = k.id), k.first_mentioned_at),
               last_mentioned_at = coalesce((select max(spoken_at) from idea_mentions where cluster_id = k.id), k.last_mentioned_at),
               timeline = ${keepTimeline}::jsonb,
               pinned = (mg.keep_before ->> 'pinned')::boolean,
               updated_at = now()
             from mg where k.id = mg.keep_id
             returning k.id)
      update idea_clusters m set
        stage = case when m.stage = 'dismissed' then mg.merged_before ->> 'stage' else m.stage end,
        mention_count = (select count(*) from idea_mentions where cluster_id = m.id and review_status <> 'dismissed'),
        centroid = coalesce((select avg(embedding) from idea_mentions where cluster_id = m.id and review_status <> 'dismissed' and embedding is not null), m.centroid),
        timeline = ${mergedTimeline}::jsonb,
        updated_at = now()
      from mg where m.id = mg.merged_id`,
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
