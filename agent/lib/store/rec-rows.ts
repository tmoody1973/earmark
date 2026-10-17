// One tip as the sync surfaces see it (M3-T1's getRec/RecRow, the slice M3-T2 and M3-T7 consume). Columns are the
// real schema: 001, 008, 011 (rec lane), 025 (Maybe? verdict). M3-T1's Notion/Slack columns (migration 012:
// slack_review_ts, rating_prompted_at) join when that migration lands. Explicit columns: never the embedding.
import { db } from "../db";
import type { EnrichmentStatus, ReviewReason } from "../recs/lane";
import type { AttributionSource, Rating, RecStatus, RecType, Source } from "../types";

export interface RecLinks { apple_music?: string; primary?: string; maps?: string; [provider: string]: string | undefined }

export interface RecRow {
  id: number;
  type: RecType;
  raw_text: string;
  canonical_name: string;
  creator: string | null;
  year_or_address: string | null;
  image_url: string | null;
  links: RecLinks;
  context_summary: string | null;
  apple_music_id: string | null;
  added_to_playlist_at: Date | null;
  recommender_id: number | null;
  recommender_first_name: string | null;
  attribution_source: AttributionSource;
  excerpt: string;
  bee_conversation_id: number | null;
  bee_journal_id: string | null;
  bee_todo_id: number | null;
  said_at: Date;
  lat: number | null;
  lng: number | null;
  source: Source;
  status: RecStatus;
  rating: Rating | null;
  confidence: number;
  enrichment_status: EnrichmentStatus;
  review_reason: ReviewReason;
  pending_since: Date;
  user_verdict: "kept" | "not_a_tip" | null;
  notion_page_id: string | null;
  updated_at: Date;
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const date = (v: unknown) => (v === null || v === undefined ? null : new Date(v as string));

export async function getRec(id: number): Promise<RecRow | null> {
  const rows = await db()`
    select r.id, r.type, r.raw_text, r.canonical_name, r.creator, r.year_or_address, r.image_url, r.links,
      r.context_summary, r.apple_music_id, r.added_to_playlist_at, r.recommender_id, p.first_name as recommender_first_name,
      r.attribution_source, r.excerpt, r.bee_conversation_id, r.bee_journal_id, r.bee_todo_id, r.said_at, r.lat, r.lng,
      r.source, r.status, r.rating, r.confidence, r.enrichment_status, r.review_reason, r.pending_since, r.user_verdict,
      r.notion_page_id, r.updated_at
    from recommendations r left join recommenders p on p.id = r.recommender_id
    where r.id = ${id}`;
  const r = rows[0];
  if (!r) return null;
  return {
    ...(r as unknown as RecRow),
    id: Number(r.id),
    recommender_id: num(r.recommender_id),
    bee_conversation_id: num(r.bee_conversation_id),
    bee_todo_id: num(r.bee_todo_id),
    said_at: new Date(r.said_at as string),
    added_to_playlist_at: date(r.added_to_playlist_at),
    pending_since: new Date(r.pending_since as string),
    updated_at: new Date(r.updated_at as string),
    lat: num(r.lat),
    lng: num(r.lng),
    confidence: Number(r.confidence),
    links: (r.links ?? {}) as RecLinks,
  };
}
