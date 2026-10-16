import { db } from "../db";
import { buildSaveQueries, savedIds, type SaveItem } from "../pipeline/save-item";
import { toVectorLiteral } from "../ideas/embed";
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

// A stored cluster near a new mention, offered to Jev as an option. excerpt: its latest accepted mention, so Jev sees
// how the idea was actually said, not only the short title.
export interface ClusterCandidate {
  id: number; title: string; excerpt: string | null; stage: IdeaStage; pinned: boolean; mentionCount: number; distance: number;
}

// Nearest clusters by cosine distance (HNSW). Clusters without a centroid (needs_review ideas, fallback creates) and
// dismissed ideas are never candidates.
export async function nearestClusters(embedding: readonly number[], k = 5): Promise<ClusterCandidate[]> {
  const v = toVectorLiteral(embedding);
  const rows = await db()`
    select c.id, c.title, c.stage, c.pinned, c.mention_count, c.centroid <=> ${v}::vector as distance,
           (select m.excerpt from idea_mentions m
             where m.cluster_id = c.id and m.review_status = 'accepted' order by m.spoken_at desc limit 1) as excerpt
    from idea_clusters c
    where c.centroid is not null and c.stage <> 'dismissed'
    order by c.centroid <=> ${v}::vector
    limit ${k}`;
  return rows.map((r) => ({
    id: Number(r.id), title: String(r.title), excerpt: r.excerpt === null ? null : String(r.excerpt), stage: r.stage as IdeaStage,
    pinned: Boolean(r.pinned), mentionCount: Number(r.mention_count), distance: Number(r.distance),
  }));
}

// One occasion (a conversation or a voice note) adds at most one mention to a cluster, so "the third mention" means
// a third separate occasion. A mention with neither id never matches.
export async function hasMentionFromSameOccasion(
  clusterId: number, m: { beeConversationId: number | null; beeJournalId: string | null },
): Promise<boolean> {
  const rows = await db()`
    select 1 from idea_mentions
    where cluster_id = ${clusterId}
      and (bee_conversation_id = ${m.beeConversationId}::bigint or bee_journal_id = ${m.beeJournalId}::text)
    limit 1`;
  return rows.length > 0;
}
