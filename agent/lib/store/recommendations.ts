import { db } from "../db";
import { clampExcerpt } from "../pipeline/excerpt";
import type { AttributionSource, RecStatus, RecType, Source } from "../types";

export interface NewRecommendation {
  type: RecType;
  rawText: string;
  canonicalName: string;
  creator: string | null;
  recommenderId: number | null;
  attributionSource: AttributionSource;
  excerpt: string;
  beeConversationId: number | null;
  beeJournalId: string | null;
  saidAt: Date;
  source: Source;
  status: RecStatus;
  confidence: number;
  // Optional: capture paths (M5 photo/song/email) know these up front; the ambient path leaves them to M3 enrichment.
  imageUrl?: string | null;
  links?: Record<string, unknown>;
  appleMusicId?: string | null;
  lat?: number | null;
  lng?: number | null;
}

/**
 * @deprecated use buildSaveQueries inside the claim transaction (M1 final review). Nothing calls this; it takes a
 * recommender id (not a name) and capture-only fields buildSaveQueries lacks, so it clamps text the same way instead.
 */
export async function insertRecommendation(r: NewRecommendation): Promise<{ id: number }> {
  const rawText = clampExcerpt(r.rawText);
  const excerpt = clampExcerpt(r.excerpt);
  const [row] = await db()`
    insert into recommendations (type, raw_text, canonical_name, creator, recommender_id, attribution_source, excerpt,
                                 bee_conversation_id, bee_journal_id, said_at, source, status, confidence,
                                 image_url, links, apple_music_id, lat, lng)
    values (${r.type}, ${rawText}, ${r.canonicalName}, ${r.creator}, ${r.recommenderId}, ${r.attributionSource}, ${excerpt},
            ${r.beeConversationId}, ${r.beeJournalId}, ${r.saidAt}, ${r.source}, ${r.status}, ${r.confidence},
            ${r.imageUrl ?? null}, ${JSON.stringify(r.links ?? {})}::jsonb, ${r.appleMusicId ?? null}, ${r.lat ?? null}, ${r.lng ?? null})
    returning id`;
  return { id: Number(row!.id) };
}
