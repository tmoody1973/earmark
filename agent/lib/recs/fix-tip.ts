// "Fix this tip" (decision 049): the owner corrects a tip's words (Bee heard "Sun Raw" for "Sun Ra"), adds detail, or
// writes its note. Three ways in share this one function: the tip page, a Bee todo edit, and a spoken correction.
// New words (name, creator, type) send the tip back to the lane for a fresh lookup, as scripts/requeue-unmatched.ts
// does, and clear everything the old words matched, so the art, the Wikipedia note, the preview and the credits come from
// the corrected words. The lane may then replace the owner's typing with the provider's own name ("sun ra" → "Sun Ra");
// if it finds nothing, the owner's words stay. A note alone is written with no lookup, and it is final (why_source
// 'owner'): the lane's why step never writes over it. What Bee heard (excerpt, raw_text) is never edited.
// Logs: none here; the callers log ids and err.name only.
import { z } from "zod";
import { db } from "../db";
import { REC_TYPES } from "../enrich/registry";
import type { RecType } from "../types";
import { PROVIDER_LINK_KEYS, SONG_CAPTURE_STRIPS, SWEEP_SKIPS_STATUSES } from "./lane";

export interface TipFix { name?: string; creator?: string | null; type?: RecType; note?: string | null }

const clearable = (max: number) => z.string().trim().max(max).transform((s) => s || null).nullable().optional(); // "" clears
/** Every way in parses with this: only the fields given change; creator or note null (or blank) clears it. */
export const TipFixSchema: z.ZodType<TipFix> = z.strictObject({
  name: z.string().trim().min(1).max(120).optional(),
  creator: clearable(120),
  type: z.enum(REC_TYPES).optional(),
  note: clearable(280),
}).refine((f) => Object.values(f).some((v) => v !== undefined), "nothing to fix");

export interface TipNow { type: RecType; canonical_name: string; creator: string | null; context_summary: string | null }
export interface TipFixPlan { type: RecType; name: string; creator: string | null; note: string | null; relook: boolean; renote: boolean }

/** The tip after the fix, or null when the fix changes nothing. relook: the words changed, so look it up again. Pure. */
export function planTipFix(now: TipNow, fix: TipFix): TipFixPlan | null {
  const next = {
    type: fix.type ?? now.type, name: fix.name ?? now.canonical_name,
    creator: fix.creator === undefined ? now.creator : fix.creator, note: fix.note === undefined ? now.context_summary : fix.note,
  };
  const relook = next.type !== now.type || next.name !== now.canonical_name || next.creator !== now.creator;
  const renote = next.note !== now.context_summary;
  return relook || renote ? { ...next, relook, renote } : null;
}

/**
 * Apply the owner's fix to tip `id`. changed false: a cleared (dismissed, composted) or missing tip, the same words
 * again, or the tip moved on between the read and the write (a sweep, another tab): nothing is written. requeued: the
 * lane will look it up again (the next sweep, within about 10 minutes). Throws on a bad id or an invalid or empty fix.
 */
export async function applyTipFix(id: number, fix: TipFix): Promise<{ changed: boolean; requeued: boolean }> {
  if (!Number.isSafeInteger(id) || id <= 0) throw new RangeError("invalid tip id");
  const f = TipFixSchema.parse(fix);
  const [now] = (await db()`select type, canonical_name, creator, context_summary from recommendations
    where id = ${id} and status <> all(${SWEEP_SKIPS_STATUSES}::text[])`) as TipNow[];
  const p = now ? planTipFix(now, f) : null;
  if (!p) return { changed: false, requeued: false };
  // A fresh lookup clears what saveMatch's correction ("fix") clears, and the same per-capture keeps: a photo's picture,
  // a shared song's Apple Music id and link. A place's coordinates were the old match's. match_source 'auto' and no
  // owner_none_at, so the lane may look and "Which one?" may ask again. The embedding goes on any change (recEmbedText).
  const rows = await db()`
    update recommendations r set
      type = ${p.type}, canonical_name = ${p.name}, creator = ${p.creator}, context_summary = ${p.note},
      why_source = case when not f.renote then r.why_source when ${p.note}::text is null then 'auto' else 'owner' end,
      embedding = null, updated_at = now(),
      enrichment_status = case when f.relook then 'pending' else r.enrichment_status end,
      enrich_attempts = case when f.relook then 0 else r.enrich_attempts end,
      enrich_next_at = case when f.relook then now() else r.enrich_next_at end,
      pending_since = case when f.relook then now() else r.pending_since end,
      enriched_at = case when f.relook then null else r.enriched_at end,
      review_reason = case when f.relook and r.review_reason = 'no_match' then null else r.review_reason end,
      match_source = case when f.relook then 'auto' else r.match_source end,
      owner_none_at = case when f.relook then null else r.owner_none_at end,
      owner_pick = case when f.relook then null else r.owner_pick end,
      auto_pick = case when f.relook then null else r.auto_pick end,
      match_candidates = case when f.relook then null else r.match_candidates end,
      candidates_at = case when f.relook then null else r.candidates_at end,
      year_or_address = case when f.relook then null else r.year_or_address end,
      image_url = case when f.relook and r.source <> 'photo' then null else r.image_url end,
      apple_music_id = case when f.relook and r.source <> 'song' then null else r.apple_music_id end,
      links = case when f.relook then r.links - (case when r.source = 'song' then ${SONG_CAPTURE_STRIPS} else ${PROVIDER_LINK_KEYS} end)::text[]
        else r.links end,
      lat = case when f.relook and (r.type = 'place' or ${p.type} = 'place') then null else r.lat end,
      lng = case when f.relook and (r.type = 'place' or ${p.type} = 'place') then null else r.lng end,
      art_retry_mbid = case when f.relook then null else r.art_retry_mbid end,
      art_retries = case when f.relook then 0 else r.art_retries end,
      about = case when f.relook then null else r.about end, about_url = case when f.relook then null else r.about_url end,
      about_at = case when f.relook then null else r.about_at end, about_tries = case when f.relook then 0 else r.about_tries end,
      extras = case when f.relook then null else r.extras end, extras_at = case when f.relook then null else r.extras_at end,
      extras_tries = case when f.relook then 0 else r.extras_tries end
    from (select ${p.relook}::boolean as relook, ${p.renote}::boolean as renote) f
    where r.id = ${id} and r.status <> all(${SWEEP_SKIPS_STATUSES}::text[])
      and r.type = ${now!.type} and r.canonical_name = ${now!.canonical_name} and r.creator is not distinct from ${now!.creator}
      and r.context_summary is not distinct from ${now!.context_summary}
    returning r.id`;
  return { changed: rows.length > 0, requeued: rows.length > 0 && p.relook };
}
