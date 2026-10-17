import { db } from "../db";
import { toVectorLiteral } from "../ideas/embed";
import { isNewBloom } from "../ideas/stage";
import { NOTE_AGAIN, NOTE_FIRST, timelineEntryJson } from "../ideas/timeline";
import type { Txn } from "../store/conversations";
import type { AttributionSource, IdeaExtraction, IdeaStage, RecExtraction, RecType, Source } from "../types";
import { clampExcerpt } from "./excerpt";

interface Common {
  route: "accept" | "review";
  beeConversationId: number | null;
  // Live stream mentions only: the stream's conversation uuid (REST knows only the numeric id; bee_conversation_map
  // links the two). Stored on the mention so a live mention and the later completed pass are one occasion.
  beeConversationUuid?: string | null;
  beeJournalId: string | null;
  // Deliberate "Earmark that" said inside a conversation: its triggered utterance's key (deliberate.ts). Unique per
  // conversation in the database, so a re-run can never save it twice. Null for everything else.
  deliberateKey?: string | null;
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
// timelineNote: the short "what this mention added" text (model-written, or the code fallback); the date is added by
// code in buildSaveQueries. Absent: "first heard" / "mentioned again".
export type ClusterPlan =
  | { action: "create"; embedding: number[] | null; timelineNote?: string }
  | { action: "join"; clusterId: number; embedding: number[]; timelineNote?: string };

// Ids of what one transaction saved, for the lanes that hook on new items (M2 clustering, M3 rec lane).
// bloomedClusterIds: clusters this save moved to 'ready' (M2-T7 drafts their one-pager).
export interface SavedIds { recIds: number[]; ideaClusterIds: number[]; mentionIds: number[]; bloomedClusterIds: number[] }
export const noneSaved = (): SavedIds => ({ recIds: [], ideaClusterIds: [], mentionIds: [], bloomedClusterIds: [] });

// Neon's transaction() resolves to one result (an array of rows) per statement, in order. buildSaveQueries emits
// exactly one statement per item, so results[i] belongs to items[i]; statements after the items are ignored.
export function savedIds(items: readonly SaveItem[], results: readonly Record<string, unknown>[][]): SavedIds {
  const row = (i: number) => results[i]![0]!;
  const ideas = items.flatMap((it, i) => (it.kind === "idea" ? [row(i)] : []));
  return {
    recIds: items.flatMap((it, i) => (it.kind === "rec" ? [Number(row(i).id)] : [])),
    ideaClusterIds: ideas.map((r) => Number(r.cluster_id)),
    mentionIds: ideas.map((r) => Number(r.id)),
    bloomedClusterIds: ideas
      .filter((r) => r.prev_stage != null && isNewBloom(r.prev_stage as IdeaStage, r.next_stage as IdeaStage))
      .map((r) => Number(r.cluster_id)),
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
    // Occasion identity: both forms of the conversation, each filled from bee_conversation_map when this caller lacks
    // it (live knows the uuid, the completed pass the numeric id), so the unique indexes on (cluster_id, id) and
    // (cluster_id, uuid) catch a live mention and the completed pass of one conversation whichever form each knew.
    const convId = item.beeConversationId;
    const convUuid = item.beeConversationUuid ?? null;
    const status = review ? "needs_review" : "accepted";
    if (plan?.action === "join") {
      const v = toVectorLiteral(plan.embedding);
      const entry = timelineEntryJson(item.spokenAt, plan.timelineNote ?? NOTE_AGAIN);
      // Stage via idea_stage_for (= stageFor) on the row's own count, so drafted/used/dismissed never move.
      // Centroid = mean of the cluster's non-dismissed mention embeddings (accepted and needs_review) plus this one
      // (the CTE's insert is not visible to the subquery, so the new vector is added explicitly).
      // Migration 004/006 unique indexes make a second mention from the same occasion fail the transaction.
      // The update returns the stage before and after (Postgres 18 RETURNING old/new); the garden event's kind mirrors
      // isNewBloom (stage.ts) in SQL, and savedIds applies isNewBloom to the same two values.
      // ponytail: two concurrent joins on one cluster may each miss the other's vector in the mean (count stays exact);
      // recompute centroids in a nightly job if live and backfill ever overlap on one idea.
      // The mention's id is drawn first (nid) so its timeline line can name it (mention_id, M4-T6: merge, undo and
      // forget match lines by mention, ideas/timeline-match.ts).
      return [
        txn`with nid as (select nextval(pg_get_serial_sequence('idea_mentions', 'id')) as id),
            m as (
              insert into idea_mentions (id, cluster_id, bee_conversation_id, bee_conversation_uuid, bee_journal_id, deliberate_key, excerpt, embedding, spoken_at, confidence, review_status, source)
              values ((select id from nid), ${plan.clusterId}::bigint,
                      coalesce(${convId}::bigint, (select bee_conversation_id from bee_conversation_map where conversation_uuid = ${convUuid}::text)),
                      coalesce(${convUuid}::text, (select conversation_uuid from bee_conversation_map where bee_conversation_id = ${convId}::bigint)),
                      ${item.beeJournalId}::text, ${item.deliberateKey ?? null}::text, ${excerpt}::text, ${v}::vector,
                      ${item.spokenAt}::timestamptz, ${item.confidence}::real, ${status}::text, ${item.source}::text)
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
                timeline = coalesce(timeline, '[]'::jsonb) || jsonb_set(${entry}::jsonb, '{0,mention_id}', to_jsonb((select id from nid))),
                updated_at = now()
              where id = ${plan.clusterId}::bigint
              returning old.stage as prev_stage, new.stage as next_stage
            ), g as (
              insert into garden_events (kind, cluster_id)
              select case when c.prev_stage <> 'ready' and c.next_stage = 'ready' then 'bloom' else 'mention' end, ${plan.clusterId}::bigint
              from c
            )
            select m.id, m.cluster_id, c.prev_stage, c.next_stage from m, c`,
      ];
    }
    const counted = 1; // every mention counts, needs_review too (Tarik: review-band ideas count; decision 004)
    const v = plan?.embedding ? toVectorLiteral(plan.embedding) : null;
    const entry = timelineEntryJson(item.spokenAt, plan?.timelineNote ?? NOTE_FIRST);
    return [
      txn`with nid as (select nextval(pg_get_serial_sequence('idea_mentions', 'id')) as id),
          c as (
            insert into idea_clusters (title, stage, mention_count, first_mentioned_at, last_mentioned_at, centroid, timeline)
            values (${item.extraction.title}, 'compost', ${counted}::int, ${item.spokenAt}::timestamptz, ${item.spokenAt}::timestamptz, ${v}::vector,
                    jsonb_set(${entry}::jsonb, '{0,mention_id}', to_jsonb((select id from nid))))
            returning id
          ), m as (
            insert into idea_mentions (id, cluster_id, bee_conversation_id, bee_conversation_uuid, bee_journal_id, deliberate_key, excerpt, embedding, spoken_at, confidence, review_status, source)
            select (select id from nid), c.id,
                   coalesce(${convId}::bigint, (select bee_conversation_id from bee_conversation_map where conversation_uuid = ${convUuid}::text)),
                   coalesce(${convUuid}::text, (select conversation_uuid from bee_conversation_map where bee_conversation_id = ${convId}::bigint)),
                   ${item.beeJournalId}::text, ${item.deliberateKey ?? null}::text, ${excerpt}::text, ${v}::vector,
                   ${item.spokenAt}::timestamptz, ${item.confidence}::real, ${status}::text, ${item.source}::text
            from c
            returning id, cluster_id
          ), g as (
            insert into garden_events (kind, cluster_id) select 'mention', id from c
          )
          select id, cluster_id, null::text as prev_stage, 'compost'::text as next_stage from m`,
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
                                       bee_conversation_id, bee_journal_id, deliberate_key, said_at, source, status, confidence)
          values (${item.recType}, ${excerpt}, ${ex.canonicalName}, ${ex.creator}, null, 'none', ${excerpt},
                  ${item.beeConversationId}, ${item.beeJournalId}, ${item.deliberateKey ?? null}, ${item.spokenAt}, ${item.source}, ${status}, ${item.confidence})
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
                                     bee_conversation_id, bee_journal_id, deliberate_key, said_at, source, status, confidence)
        select ${item.recType}::text, ${excerpt}::text, ${ex.canonicalName}::text, ${ex.creator}::text, r.id, ${attribution.source}::text, ${excerpt}::text,
               ${item.beeConversationId}::bigint, ${item.beeJournalId}::text, ${item.deliberateKey ?? null}::text, ${item.spokenAt}::timestamptz, ${item.source}::text, ${status}::text, ${item.confidence}::real
        from r
        returning id`,
  ];
}

// One item in its own transaction (voice notes, M1-T12). Conversations batch buildSaveQueries themselves.
export async function saveAcceptedItem(item: SaveItem): Promise<{ kind: "rec" | "idea"; id: number }> {
  const [rows] = await db().transaction((txn) => buildSaveQueries(txn, item));
  return { kind: item.kind, id: Number(rows![0]!.id) };
}
