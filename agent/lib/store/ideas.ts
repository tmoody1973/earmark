import { db } from "../db";
import { buildSaveQueries, savedIds, type SaveItem } from "../pipeline/save-item";
import { toVectorLiteral } from "../ideas/embed";
import type { DraftFormat } from "../ideas/one-pager";
import type { TimelineEntry } from "../ideas/timeline";
import type { IdeaStage, Source } from "../types";
import { CLAIM_LEASE, type Txn } from "./conversations";

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
// spokenAt (M2-T14): Bee also hears a voice note inside the conversation recording at the same time. A mention on this
// cluster from the OTHER source (journal vs conversation, live uuid-only mentions count as conversation) spoken within
// ±60 s of this one is the same occasion.
export interface OccasionSpan { start: Date; end: Date }
const SPAN_SLACK = "60 seconds";
export async function hasMentionFromSameOccasion(
  clusterId: number,
  m: { beeConversationId: number | null; beeJournalId: string | null; beeConversationUuid?: string | null; span?: OccasionSpan; spokenAt?: Date },
): Promise<boolean> {
  const id = m.beeConversationId;
  const uuid = m.beeConversationUuid ?? null;
  const start = m.span?.start ?? null;
  const end = m.span?.end ?? null;
  const at = m.spokenAt ?? null;
  const fromJournal = m.beeJournalId !== null;
  const rows = await db()`
    select 1 from idea_mentions
    where cluster_id = ${clusterId}
      and (bee_conversation_id = ${id}::bigint or bee_journal_id = ${m.beeJournalId}::text or bee_conversation_uuid = ${uuid}::text
           or bee_conversation_uuid in (select conversation_uuid from bee_conversation_map where bee_conversation_id = ${id}::bigint)
           or bee_conversation_id in (select bee_conversation_id from bee_conversation_map where conversation_uuid = ${uuid}::text)
           or (bee_conversation_id is null and bee_conversation_uuid is not null
               and spoken_at between ${start}::timestamptz - ${SPAN_SLACK}::interval and ${end}::timestamptz + ${SPAN_SLACK}::interval)
           or (spoken_at between ${at}::timestamptz - ${SPAN_SLACK}::interval and ${at}::timestamptz + ${SPAN_SLACK}::interval
               and case when ${fromJournal}::boolean then bee_journal_id is null and (bee_conversation_id is not null or bee_conversation_uuid is not null)
                        else bee_journal_id is not null end))
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

// ── One-pager drafts (M2-T7) ──────────────────────────────────────────────────────────────────────────────────────
// A bloomed cluster is drafted after its bloom committed (never inside the claim transaction). Claim → draft → save:
// the claim is the done-lease pattern (migration 009); "done" = draft saved with stage 'drafted' in ONE statement.

// A cluster whose draft failed this many times is left bloomed without a draft (logged) until someone resets it.
export const MAX_DRAFT_ATTEMPTS = 3;

// Claim up to `limit` bloomed clusters without a draft (optionally only these ids). SKIP LOCKED + the lease: two runners
// never get the same cluster; a claim from a run that crashed is re-taken once older than CLAIM_LEASE.
// attempts: this claim's attempt number (1-based), so the caller can tell when the last allowed attempt failed.
// claim: this claim's draft_claimed_at as exact text (microseconds kept); saveDraft writes only while it is still current.
export async function claimDraftableClusters(opts: { clusterIds?: number[]; limit: number }): Promise<Array<{ id: number; attempts: number; claim: string }>> {
  const ids = opts.clusterIds ?? null;
  const rows = await db()`
    with open as (
      select id from idea_clusters
      where stage = 'ready' and draft_md is null and draft_attempts < ${MAX_DRAFT_ATTEMPTS}
        and (draft_claimed_at is null or draft_claimed_at < now() - ${CLAIM_LEASE}::interval)
        and (${ids}::bigint[] is null or id = any(${ids}::bigint[]))
      order by last_mentioned_at desc nulls last, id
      limit ${opts.limit}
      for update skip locked
    )
    update idea_clusters c set draft_claimed_at = now(), draft_attempts = c.draft_attempts + 1
    from open where c.id = open.id
    returning c.id, c.draft_attempts, c.draft_claimed_at::text as claim`;
  return rows.map((r) => ({ id: Number(r.id), attempts: Number(r.draft_attempts), claim: String(r.claim) }));
}

// Manual retry after MAX_DRAFT_ATTEMPTS (scripts/draft-one-pager.ts --reset): attempts back to 0, claim cleared.
export async function resetDraftAttempts(clusterId: number): Promise<void> {
  await db()`update idea_clusters set draft_attempts = 0, draft_claimed_at = null where id = ${clusterId} and draft_md is null`;
}

// Failed draft: give the claim back so a later run retries (attempts were counted at claim time).
export async function releaseDraftClaim(clusterId: number): Promise<void> {
  await db()`update idea_clusters set draft_claimed_at = null where id = ${clusterId} and draft_md is null`;
}

// Every non-dismissed mention (needs_review too: unconfirmed clusters bloom and are drafted, decision 004) and the
// stored timeline. Order is not guaranteed: callers sort by date.
export interface ClusterForDraft {
  id: number; title: string; timeline: TimelineEntry[]; mentions: Array<{ excerpt: string; spokenAt: Date }>;
}
export async function getClusterForDraft(clusterId: number): Promise<ClusterForDraft | null> {
  const sql = db();
  const [c] = await sql`select id, title, timeline from idea_clusters where id = ${clusterId}`;
  if (!c) return null;
  const ms = await sql`select excerpt, spoken_at from idea_mentions where cluster_id = ${clusterId} and review_status <> 'dismissed'`;
  return {
    id: Number(c.id), title: String(c.title), timeline: (c.timeline ?? []) as TimelineEntry[],
    mentions: ms.map((m) => ({ excerpt: String(m.excerpt), spokenAt: new Date(m.spoken_at) })),
  };
}

// Statement builder only (amendment a: no stray writers): run it inside db().transaction. Saves the draft, its format
// and stage ready → drafted together, and only while the cluster is still ready without a draft AND the claim this
// drafter holds is still current (no row otherwise). `pnpm forget` clears the claim when it removes an excerpt, so a
// draft written from the old excerpts can never be saved afterwards (M3-T11).
export function saveDraft(txn: Txn, clusterId: number, draftMd: string, format: DraftFormat, claim: string) {
  return txn`update idea_clusters
             set draft_md = ${draftMd}, draft_format = ${format}, stage = 'drafted', draft_claimed_at = null, updated_at = now()
             where id = ${clusterId} and stage = 'ready' and draft_md is null and draft_claimed_at = ${claim}::timestamptz
             returning id`;
}
