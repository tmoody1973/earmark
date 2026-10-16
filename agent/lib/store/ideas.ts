import { db } from "../db";
import { buildSaveQueries, savedIds, type SaveItem } from "../pipeline/save-item";
import { toVectorLiteral } from "../ideas/embed";
import type { TimelineEntry } from "../ideas/timeline";
import type { IdeaStage, Source } from "../types";

export interface NewIdeaMention {
  beeConversationId: number | null;
  beeJournalId: string | null;
  excerpt: string;
  spokenAt: Date;
  confidence: number;
  reviewStatus: "accepted" | "needs_review";
  source: Source;
}

/**
 * @deprecated use buildSaveQueries inside the claim transaction (M1 final review). Kept for the M1 contract only;
 * it delegates to buildSaveQueries so its SQL (and the 25-word clamp) cannot drift.
 */
export async function createClusterWithMention(m: NewIdeaMention & { title: string }): Promise<{ clusterId: number; mentionId: number }> {
  const item: SaveItem = {
    kind: "idea", route: m.reviewStatus === "accepted" ? "accept" : "review", extraction: { title: m.title, excerpt: m.excerpt },
    beeConversationId: m.beeConversationId, beeJournalId: m.beeJournalId, spokenAt: m.spokenAt, confidence: m.confidence, source: m.source,
  };
  const saved = savedIds([item], await db().transaction((txn) => buildSaveQueries(txn, item)));
  return { clusterId: saved.ideaClusterIds[0]!, mentionId: saved.mentionIds[0]! };
}

// A stored cluster near a new mention, offered to Jev as an option. excerpt: its latest non-dismissed mention, so Jev sees
// how the idea was actually said, not only the short title.
export interface ClusterCandidate {
  id: number; title: string; excerpt: string | null; stage: IdeaStage; pinned: boolean; mentionCount: number; distance: number;
}

// Nearest clusters by cosine distance (HNSW). Clusters without a centroid (failed-embedding fallbacks, legacy rows) are
// never candidates. Dismissed clusters are (Tarik: dismissed stays dismissed; a new mention attaches, stage unchanged).
export async function nearestClusters(embedding: readonly number[], k = 5): Promise<ClusterCandidate[]> {
  const v = toVectorLiteral(embedding);
  const rows = await db()`
    select c.id, c.title, c.stage, c.pinned, c.mention_count, c.centroid <=> ${v}::vector as distance,
           (select m.excerpt from idea_mentions m
             where m.cluster_id = c.id and m.review_status <> 'dismissed' order by m.spoken_at desc limit 1) as excerpt
    from idea_clusters c
    where c.centroid is not null
    order by c.centroid <=> ${v}::vector
    limit ${k}`;
  return rows.map((r) => ({
    id: Number(r.id), title: String(r.title), excerpt: r.excerpt === null ? null : String(r.excerpt), stage: r.stage as IdeaStage,
    pinned: Boolean(r.pinned), mentionCount: Number(r.mention_count), distance: Number(r.distance),
  }));
}

// One occasion (a conversation or a voice note) adds at most one mention to a cluster, so "the third mention" means
// a third separate occasion. A conversation is one occasion whether a mention knew its numeric REST id (completed
// pass), its stream uuid (live, before the uuid was mapped) or both: bee_conversation_map links the two forms.
// A mention with no id at all never matches.
// span (completed pass only): the conversation's start/end. A live mention whose uuid was never mapped (bee_conversation_id
// null) and that was spoken inside [start − 60 s, end + 60 s] is treated as this conversation. This relies on Bee
// capturing ONE conversation at a time (one wearable): two conversations never overlap in time.
export interface OccasionSpan { start: Date; end: Date }
const SPAN_SLACK = "60 seconds";
export async function hasMentionFromSameOccasion(
  clusterId: number,
  m: { beeConversationId: number | null; beeJournalId: string | null; beeConversationUuid?: string | null; span?: OccasionSpan },
): Promise<boolean> {
  const id = m.beeConversationId;
  const uuid = m.beeConversationUuid ?? null;
  const start = m.span?.start ?? null;
  const end = m.span?.end ?? null;
  const rows = await db()`
    select 1 from idea_mentions
    where cluster_id = ${clusterId}
      and (bee_conversation_id = ${id}::bigint or bee_journal_id = ${m.beeJournalId}::text or bee_conversation_uuid = ${uuid}::text
           or bee_conversation_uuid in (select conversation_uuid from bee_conversation_map where bee_conversation_id = ${id}::bigint)
           or bee_conversation_id in (select bee_conversation_id from bee_conversation_map where conversation_uuid = ${uuid}::text)
           or (bee_conversation_id is null and bee_conversation_uuid is not null
               and spoken_at between ${start}::timestamptz - ${SPAN_SLACK}::interval and ${end}::timestamptz + ${SPAN_SLACK}::interval))
    limit 1`;
  return rows.length > 0;
}

// Derived, no column (decision 004): a cluster is confirmed once any of its mentions is accepted; until then it is
// "unconfirmed" (review-band mentions only) but still counts toward its stage.
export async function isClusterConfirmed(clusterId: number): Promise<boolean> {
  const rows = await db()`select 1 from idea_mentions where cluster_id = ${clusterId} and review_status = 'accepted' limit 1`;
  return rows.length > 0;
}

// Read helper only: timeline lines are appended inside buildSaveQueries' join/create statements, never by a separate write.
export async function getClusterTimeline(clusterId: number): Promise<TimelineEntry[]> {
  const rows = await db()`select timeline from idea_clusters where id = ${clusterId}`;
  return (rows[0]?.timeline ?? []) as TimelineEntry[];
}
