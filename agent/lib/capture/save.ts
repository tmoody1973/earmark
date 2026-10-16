import { db } from "../db";
import { ownerFirstName } from "../env";
import { validNameFor } from "../pipeline/attribution";
import { clampExcerpt } from "../pipeline/excerpt";
import { sameNormalizedName } from "../pipeline/same-moment";
import type { LatLng } from "../geo";
import type { AttributionSource, RecType, Source } from "../types";

export interface CaptureRec {
  type: RecType;
  rawText: string;
  canonicalName: string;
  creator: string | null;
  imageUrl: string | null;
  links: Record<string, unknown>;
  appleMusicId: string | null;
  // The recommender's first name as proposed by the linker. Re-vetted here: it must appear in `evidence`, and the
  // owner is never credited. Anything that fails becomes "no recommender".
  recommenderName: string | null;
  evidence: (string | null)[];
  attributionSource: AttributionSource;
  excerpt: string;
  beeConversationId: number | null;
  saidAt: Date;
  confidence: number;
  source: Source;
  // Photo captures only: the photos row, written in the same transaction as the recommendation.
  photo?: { takenAt: Date; where: LatLng | null; conversationId: number | null; thumbnailUrl: string | null };
}

// ONE transaction per capture. Same conversation + same normalized name as an existing rec -> upgrade it (fill in
// image / links / Apple Music id, keep its status and recommender). Otherwise insert, upserting the recommender.
// Neon transactions are a fixed batch of statements, so the duplicate lookup happens just before it; a second
// capture racing between the two would insert a duplicate, which a single-owner app accepts (decision 033).
//
// `recentDuplicateMs` (song captures): a rec from the same source with the same normalized title (and artist, when
// given) created within that window is returned untouched with `duplicate: true`, whether or not a conversation was
// picked. This is what makes a double press of the Action button save once.
export interface SaveOptions {
  recentDuplicateMs?: number;
}
export interface SaveResult {
  id: number;
  upgraded: boolean;
  duplicate?: boolean;
}

export async function saveCaptureRec(rec: CaptureRec, opts: SaveOptions = {}): Promise<SaveResult> {
  const sql = db();
  if (opts.recentDuplicateMs) {
    const dupId = await findRecentDuplicate(rec, opts.recentDuplicateMs);
    if (dupId !== null) return { id: dupId, upgraded: false, duplicate: true };
  }
  const existingId = await findExisting(rec);
  const photo = rec.photo;
  const photoArgs = photo
    ? [photo.takenAt.toISOString(), photo.where?.lat ?? null, photo.where?.lng ?? null, photo.conversationId, photo.thumbnailUrl]
    : [null, null, null, null, null];
  const links = JSON.stringify(rec.links);

  if (existingId !== null) {
    const [upd] = await sql.transaction((txn) => [
      txn`update recommendations set
            image_url = coalesce(image_url, ${rec.imageUrl}::text),
            links = ${links}::jsonb || links,
            apple_music_id = coalesce(apple_music_id, ${rec.appleMusicId}::text),
            updated_at = now()
          where id = ${existingId}::bigint
          returning id`,
      txn`insert into photos (recommendation_id, taken_at, lat, lng, linked_bee_conversation_id, thumbnail_url)
          select ${existingId}::bigint, ${photoArgs[0]}::timestamptz, ${photoArgs[1]}::float8, ${photoArgs[2]}::float8, ${photoArgs[3]}::bigint, ${photoArgs[4]}::text
          where ${photo ? true : false}::boolean`,
    ]);
    return { id: Number(upd![0]!.id), upgraded: true };
  }

  const name = validNameFor(ownerFirstName(), rec.recommenderName, ...rec.evidence);
  const source: AttributionSource = name ? rec.attributionSource : "none";
  const rawText = clampExcerpt(rec.rawText);
  const excerpt = clampExcerpt(rec.excerpt);
  const [ins] = await sql.transaction((txn) => [
    txn`with r as (
          insert into recommenders (first_name, recs_given)
          select ${name}::text, 1 where ${name}::text is not null
          on conflict (first_name_key) do update set recs_given = recommenders.recs_given + 1
          returning id
        ), i as (
          insert into recommendations (type, raw_text, canonical_name, creator, recommender_id, attribution_source, excerpt,
                                       bee_conversation_id, said_at, source, status, confidence,
                                       image_url, links, apple_music_id)
          values (${rec.type}::text, ${rawText}::text, ${rec.canonicalName}::text, ${rec.creator}::text, (select id from r),
                  ${source}::text, ${excerpt}::text, ${rec.beeConversationId}::bigint, ${rec.saidAt.toISOString()}::timestamptz,
                  ${rec.source}::text, 'new', ${rec.confidence}::real,
                  ${rec.imageUrl}::text, ${links}::jsonb, ${rec.appleMusicId}::text)
          returning id
        ), p as (
          insert into photos (recommendation_id, taken_at, lat, lng, linked_bee_conversation_id, thumbnail_url)
          select i.id, ${photoArgs[0]}::timestamptz, ${photoArgs[1]}::float8, ${photoArgs[2]}::float8, ${photoArgs[3]}::bigint, ${photoArgs[4]}::text
          from i where ${photo ? true : false}::boolean
        )
        select id from i`,
  ]);
  return { id: Number(ins![0]!.id), upgraded: false };
}

async function findExisting(rec: CaptureRec): Promise<number | null> {
  if (rec.beeConversationId === null) return null;
  const rows = await db()`select id, canonical_name from recommendations
                          where bee_conversation_id = ${rec.beeConversationId} order by id`;
  const hit = rows.find((r) => sameNormalizedName(String(r.canonical_name), rec.canonicalName));
  return hit ? Number(hit.id) : null;
}

async function findRecentDuplicate(rec: CaptureRec, windowMs: number): Promise<number | null> {
  const rows = await db()`select id, canonical_name, creator from recommendations
                          where source = ${rec.source}::text and created_at > now() - make_interval(secs => ${windowMs / 1000}::float8)
                          order by id desc`;
  const hit = rows.find(
    (r) => sameNormalizedName(String(r.canonical_name), rec.canonicalName) &&
      (!rec.creator || (r.creator !== null && sameNormalizedName(String(r.creator), rec.creator))),
  );
  return hit ? Number(hit.id) : null;
}
