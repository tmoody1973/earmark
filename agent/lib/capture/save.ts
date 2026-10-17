import { db } from "../db";
import { ownerFirstName } from "../env";
import { validNameFor } from "../pipeline/attribution";
import { clampExcerpt } from "../pipeline/excerpt";
import { normalizeName, sameNormalizedName } from "../pipeline/same-moment";
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
  status?: "new" | "needs_review"; // default "new"; an email forward that triage doubts is kept for review
  // Photo captures only: the photos row, written in the same transaction as the recommendation.
  photo?: { takenAt: Date; where: LatLng | null; conversationId: number | null; thumbnailUrl: string | null };
}

// ONE transaction per capture. Same conversation + same normalized name as an existing rec -> upgrade it (fill in
// image / links / Apple Music id, keep its status and recommender). Otherwise insert, upserting the recommender.
//
// `recentDuplicateMs` (song captures): double-press guard. The insert path takes a transaction-scoped advisory lock
// on source + normalized title, then inserts only `where not exists` a rec from the same source created inside the
// window with the same title (and artist, when given) or the same Apple Music id. The lock serializes two presses
// racing each other; the statement after the lock sees the first press's committed row. When nothing is inserted the
// existing rec's id comes back with `duplicate: true`. An upgrade that would change nothing is also `duplicate: true`.
export interface SaveOptions {
  recentDuplicateMs?: number;
}
export interface SaveResult {
  id: number;
  upgraded: boolean;
  duplicate?: boolean;
}

// SQL twin of normalizeName() (same-moment.ts): lower, drop (..)/[..] asides and apostrophes, punctuation -> space,
// trim, drop a leading article. Written inline because Neon tagged templates only take values as parameters.
export async function saveCaptureRec(rec: CaptureRec, opts: SaveOptions = {}): Promise<SaveResult> {
  const sql = db();
  const existing = await findExisting(rec);
  const photo = rec.photo;
  const photoArgs = photo
    ? [photo.takenAt.toISOString(), photo.where?.lat ?? null, photo.where?.lng ?? null, photo.conversationId, photo.thumbnailUrl]
    : [null, null, null, null, null];
  const links = JSON.stringify(rec.links);

  if (existing !== null) {
    if (!upgradeWouldChange(existing, rec)) return { id: existing.id, upgraded: false, duplicate: true };
    const [upd] = await sql.transaction((txn) => [
      txn`update recommendations set
            image_url = coalesce(image_url, ${rec.imageUrl}::text),
            links = ${links}::jsonb || links,
            apple_music_id = coalesce(apple_music_id, ${rec.appleMusicId}::text),
            updated_at = now()
          where id = ${existing.id}::bigint
          returning id`,
      txn`insert into photos (recommendation_id, taken_at, lat, lng, linked_bee_conversation_id, thumbnail_url)
          select ${existing.id}::bigint, ${photoArgs[0]}::timestamptz, ${photoArgs[1]}::float8, ${photoArgs[2]}::float8, ${photoArgs[3]}::bigint, ${photoArgs[4]}::text
          where ${photo ? true : false}::boolean`,
    ]);
    return { id: Number(upd![0]!.id), upgraded: true };
  }

  const name = validNameFor(ownerFirstName(), rec.recommenderName, ...rec.evidence);
  const source: AttributionSource = name ? rec.attributionSource : "none";
  const rawText = clampExcerpt(rec.rawText);
  const excerpt = clampExcerpt(rec.excerpt);
  const guard = Boolean(opts.recentDuplicateMs);
  const windowSecs = (opts.recentDuplicateMs ?? 0) / 1000;
  const titleKey = normalizeName(rec.canonicalName);
  const creatorKey = rec.creator ? normalizeName(rec.creator) : null;
  const [, ins, dup] = await sql.transaction((txn) => [
    txn`select pg_advisory_xact_lock(hashtext(${`${rec.source}:${titleKey}`}::text))`,
    txn`with ok as (
          select 1 as one where not (${guard}::boolean and exists (
            select 1 from recommendations d
            where d.source = ${rec.source}::text
              and d.created_at > now() - make_interval(secs => ${windowSecs}::float8)
              and (
                (regexp_replace(btrim(regexp_replace(regexp_replace(regexp_replace(lower(d.canonical_name), '[(][^)]*[)]|[[][^]]*[]]', ' ', 'g'), '[''’]', '', 'g'), '[^[:alnum:]]+', ' ', 'g')), '^(the|a|an) ', '') = ${titleKey}::text
                 and (${creatorKey}::text is null or regexp_replace(btrim(regexp_replace(regexp_replace(regexp_replace(lower(coalesce(d.creator, '')), '[(][^)]*[)]|[[][^]]*[]]', ' ', 'g'), '[''’]', '', 'g'), '[^[:alnum:]]+', ' ', 'g')), '^(the|a|an) ', '') = ${creatorKey}::text))
                or (${rec.appleMusicId}::text is not null and d.apple_music_id = ${rec.appleMusicId}::text)
              )
          ))
        ), r as (
          insert into recommenders (first_name, recs_given)
          select ${name}::text, 1 where ${name}::text is not null and exists (select 1 from ok)
          on conflict (first_name_key) do update set recs_given = recommenders.recs_given + 1
          returning id
        ), i as (
          insert into recommendations (type, raw_text, canonical_name, creator, recommender_id, attribution_source, excerpt,
                                       bee_conversation_id, said_at, source, status, confidence,
                                       image_url, links, apple_music_id)
          select ${rec.type}::text, ${rawText}::text, ${rec.canonicalName}::text, ${rec.creator}::text, (select id from r),
                 ${source}::text, ${excerpt}::text, ${rec.beeConversationId}::bigint, ${rec.saidAt.toISOString()}::timestamptz,
                 ${rec.source}::text, ${rec.status ?? "new"}::text, ${rec.confidence}::real,
                 ${rec.imageUrl}::text, ${links}::jsonb, ${rec.appleMusicId}::text
          where exists (select 1 from ok)
          returning id
        ), p as (
          insert into photos (recommendation_id, taken_at, lat, lng, linked_bee_conversation_id, thumbnail_url)
          select i.id, ${photoArgs[0]}::timestamptz, ${photoArgs[1]}::float8, ${photoArgs[2]}::float8, ${photoArgs[3]}::bigint, ${photoArgs[4]}::text
          from i where ${photo ? true : false}::boolean
        )
        select id from i`,
    // Only read when the insert was skipped (ins empty): the earliest recent rec that tripped the guard.
    txn`select d.id from recommendations d
        where ${guard}::boolean and d.source = ${rec.source}::text
          and d.created_at > now() - make_interval(secs => ${windowSecs}::float8)
          and (
            (regexp_replace(btrim(regexp_replace(regexp_replace(regexp_replace(lower(d.canonical_name), '[(][^)]*[)]|[[][^]]*[]]', ' ', 'g'), '[''’]', '', 'g'), '[^[:alnum:]]+', ' ', 'g')), '^(the|a|an) ', '') = ${titleKey}::text
             and (${creatorKey}::text is null or regexp_replace(btrim(regexp_replace(regexp_replace(regexp_replace(lower(coalesce(d.creator, '')), '[(][^)]*[)]|[[][^]]*[]]', ' ', 'g'), '[''’]', '', 'g'), '[^[:alnum:]]+', ' ', 'g')), '^(the|a|an) ', '') = ${creatorKey}::text))
            or (${rec.appleMusicId}::text is not null and d.apple_music_id = ${rec.appleMusicId}::text)
          )
        order by d.id limit 1`,
  ]);
  if (ins!.length > 0) return { id: Number(ins![0]!.id), upgraded: false };
  if (dup!.length === 0) throw new Error("capture insert skipped without a duplicate");
  return { id: Number(dup![0]!.id), upgraded: false, duplicate: true };
}

interface ExistingRec {
  id: number;
  imageUrl: string | null;
  appleMusicId: string | null;
  links: Record<string, unknown>;
}

// An upgrade only fills gaps: image, Apple Music id, and link keys the rec does not have yet.
function upgradeWouldChange(e: ExistingRec, rec: CaptureRec): boolean {
  return (
    (e.imageUrl === null && rec.imageUrl !== null) ||
    (e.appleMusicId === null && rec.appleMusicId !== null) ||
    Object.keys(rec.links).some((k) => !(k in e.links)) ||
    rec.photo !== undefined // a photo capture always adds its photos row
  );
}

async function findExisting(rec: CaptureRec): Promise<ExistingRec | null> {
  if (rec.beeConversationId === null) return null;
  const rows = await db()`select id, canonical_name, image_url, apple_music_id, links from recommendations
                          where bee_conversation_id = ${rec.beeConversationId} order by id`;
  const hit = rows.find((r) => sameNormalizedName(String(r.canonical_name), rec.canonicalName));
  return hit
    ? { id: Number(hit.id), imageUrl: (hit.image_url as string | null) ?? null, appleMusicId: (hit.apple_music_id as string | null) ?? null, links: (hit.links as Record<string, unknown>) ?? {} }
    : null;
}
