import { db } from "../db";
import { toVectorLiteral } from "../ideas/embed";
import type { Txn } from "../store/conversations";
import type { AttributionSource, IdeaExtraction, RecExtraction, RecType, Source } from "../types";
import { clampExcerpt } from "./excerpt";

interface Common {
  route: "accept" | "review";
  beeConversationId: number | null;
  beeJournalId: string | null;
  spokenAt: Date;
  confidence: number;
  source: Source;
}

export type SaveItem =
  | (Common & {
      kind: "rec";
      recType: RecType;
      extraction: RecExtraction;
      // From chooseRecommender; firstName null means nobody qualified (never guessed).
      attribution: { firstName: string | null; source: AttributionSource };
    })
  | (Common & { kind: "idea"; extraction: IdeaExtraction; cluster?: ClusterPlan });

// Where an idea mention goes (accepted or needs_review alike), decided before the transaction by planIdeaClusters.
// create: a new cluster (embedding null when embedding failed: no centroid, so never a nearest candidate).
// join: one more mention on an existing cluster. Absent (legacy callers): a new cluster, no embedding.
export type ClusterPlan =
  | { action: "create"; embedding: number[] | null }
  | { action: "join"; clusterId: number; embedding: number[] };

// Ids of what one transaction saved, for the lanes that hook on new items (M2 clustering, M3 rec lane).
export interface SavedIds { recIds: number[]; ideaClusterIds: number[]; mentionIds: number[] }
export const noneSaved = (): SavedIds => ({ recIds: [], ideaClusterIds: [], mentionIds: [] });

// Neon's transaction() resolves to one result (an array of rows) per statement, in order. buildSaveQueries emits
// exactly one statement per item, so results[i] belongs to items[i]; statements after the items are ignored.
export function savedIds(items: readonly SaveItem[], results: readonly Record<string, unknown>[][]): SavedIds {
  const row = (i: number) => results[i]![0]!;
  return {
    recIds: items.flatMap((it, i) => (it.kind === "rec" ? [Number(row(i).id)] : [])),
    ideaClusterIds: items.flatMap((it, i) => (it.kind === "idea" ? [Number(row(i).cluster_id)] : [])),
    mentionIds: items.flatMap((it, i) => (it.kind === "idea" ? [Number(row(i).id)] : [])),
  };
}

// The ONLY way accepted ideas and recs are written (M2/M3 change these statements, not separate store functions).
// One self-contained statement per item (CTEs), so any number of items plus other statements can share one
// transaction. Every Bee-derived text field is clamped to 25 words here, whatever the caller passed.
// Explicit casts: untyped parameters in INSERT ... SELECT resolve as text and would be rejected by typed columns.
export function buildSaveQueries(txn: Txn, item: SaveItem) {
  const review = item.route === "review";
  if (item.kind === "idea") {
    const plan = item.cluster;
    const excerpt = clampExcerpt(item.extraction.excerpt);
    if (plan?.action === "join") {
      const v = toVectorLiteral(plan.embedding);
      // Stage via idea_stage_for (= stageFor) on the row's own count, so drafted/used/dismissed never move.
      // Centroid = mean of the cluster's non-dismissed mention embeddings (accepted and needs_review) plus this one
      // (the CTE's insert is not visible to the subquery, so the new vector is added explicitly).
      // Migration 004's unique indexes make a second mention from the same conversation/journal fail the transaction.
      // ponytail: two concurrent joins on one cluster may each miss the other's vector in the mean (count stays exact);
      // recompute centroids in a nightly job if live and backfill ever overlap on one idea.
      return [
        txn`with m as (
              insert into idea_mentions (cluster_id, bee_conversation_id, bee_journal_id, excerpt, embedding, spoken_at, confidence, review_status, source)
              values (${plan.clusterId}::bigint, ${item.beeConversationId}::bigint, ${item.beeJournalId}::text, ${excerpt}::text, ${v}::vector,
                      ${item.spokenAt}::timestamptz, ${item.confidence}::real, ${review ? "needs_review" : "accepted"}::text, ${item.source}::text)
              returning id, cluster_id
            ), c as (
              update idea_clusters set
                mention_count = mention_count + 1,
                stage = idea_stage_for(stage, mention_count + 1),
                centroid = (select avg(e) from (
                              select embedding as e from idea_mentions
                              where cluster_id = ${plan.clusterId}::bigint and review_status <> 'dismissed' and embedding is not null
                              union all select ${v}::vector) s),
                first_mentioned_at = least(first_mentioned_at, ${item.spokenAt}::timestamptz),
                last_mentioned_at = greatest(last_mentioned_at, ${item.spokenAt}::timestamptz),
                updated_at = now()
              where id = ${plan.clusterId}::bigint
            )
            select id, cluster_id from m`,
      ];
    }
    const counted = 1; // every mention counts, needs_review too (Tarik: review-band ideas count; decision 004)
    const v = plan?.embedding ? toVectorLiteral(plan.embedding) : null;
    return [
      txn`with c as (
            insert into idea_clusters (title, stage, mention_count, first_mentioned_at, last_mentioned_at, centroid)
            values (${item.extraction.title}, 'compost', ${counted}::int, ${item.spokenAt}::timestamptz, ${item.spokenAt}::timestamptz, ${v}::vector)
            returning id
          )
          insert into idea_mentions (cluster_id, bee_conversation_id, bee_journal_id, excerpt, embedding, spoken_at, confidence, review_status, source)
          select c.id, ${item.beeConversationId}::bigint, ${item.beeJournalId}::text, ${excerpt}::text, ${v}::vector,
                 ${item.spokenAt}::timestamptz, ${item.confidence}::real, ${review ? "needs_review" : "accepted"}::text, ${item.source}::text
          from c
          returning id, cluster_id`,
    ];
  }
  const { extraction: ex, attribution } = item;
  const excerpt = clampExcerpt(ex.excerpt);
  const status = review ? "needs_review" : "new";
  const name = attribution.firstName;
  // No recommender: plain insert, never a guessed name, attribution forced to 'none'.
  if (!name) {
    return [
      txn`insert into recommendations (type, raw_text, canonical_name, creator, recommender_id, attribution_source, excerpt,
                                       bee_conversation_id, bee_journal_id, said_at, source, status, confidence)
          values (${item.recType}, ${excerpt}, ${ex.canonicalName}, ${ex.creator}, null, 'none', ${excerpt},
                  ${item.beeConversationId}, ${item.beeJournalId}, ${item.spokenAt}, ${item.source}, ${status}, ${item.confidence})
          returning id`,
    ];
  }
  return [
    txn`with r as (
          insert into recommenders (first_name, recs_given) values (${name}, 1)
          on conflict (first_name_key) do update set recs_given = recommenders.recs_given + 1
          returning id
        )
        insert into recommendations (type, raw_text, canonical_name, creator, recommender_id, attribution_source, excerpt,
                                     bee_conversation_id, bee_journal_id, said_at, source, status, confidence)
        select ${item.recType}::text, ${excerpt}::text, ${ex.canonicalName}::text, ${ex.creator}::text, r.id, ${attribution.source}::text, ${excerpt}::text,
               ${item.beeConversationId}::bigint, ${item.beeJournalId}::text, ${item.spokenAt}::timestamptz, ${item.source}::text, ${status}::text, ${item.confidence}::real
        from r
        returning id`,
  ];
}

// One item in its own transaction (voice notes, M1-T12). Conversations batch buildSaveQueries themselves.
export async function saveAcceptedItem(item: SaveItem): Promise<{ kind: "rec" | "idea"; id: number }> {
  const [rows] = await db().transaction((txn) => buildSaveQueries(txn, item));
  return { kind: item.kind, id: Number(rows![0]!.id) };
}
