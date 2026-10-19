// "Which one?" (decision 048): the owner confirms or corrects which real-world item a tip is. Three answers:
// - pick a stored candidate: applied through the lane's own saveMatch, and final (match_source 'owner');
// - None of these: final no_match (owner_none_at), the question goes away;
// - Search again: the tip type's provider with the owner's words (music: MusicBrainz and Apple together, decision 050),
//   new candidates stored, nothing picked.
// Only Search again calls a provider, and only when the owner asks: one search per tip per 10 s, refused when the
// provider isn't configured, a 503/429 answered with "try again in a bit". The query is the owner's own words (2-120
// characters); what was said is never sent. Logs: ids and err.name only.
import { db } from "../db";
import { appleAccess } from "../enrich/apple-music";
import { biasFor } from "../enrich/bias";
import { searchMusic } from "../enrich/music";
import { providerFor, type NamedProvider } from "../enrich/registry";
import { logEnrichError, runProvider, type EnrichQuery } from "../enrich/types";
import { candidateKey, readCandidates, type StoredCandidate } from "../garden/which-one";
import type { RecType } from "../types";
import { applyReviewReason, isBackOffSignal, saveMatch, SWEEP_SKIPS_STATUSES } from "./lane";

export const SEARCH_EVERY_SECONDS = 10;

/**
 * The owner picks stored candidate `index`, which the page named `key` (candidateKey). changed false: the stored list
 * moved on (a second look or another tab's search replaced it), no such candidate, a cleared tip, or already settled.
 */
export async function pickCandidate(id: number, index: number, key: string): Promise<{ changed: boolean }> {
  const [row] = await db()`select match_candidates from recommendations where id = ${id} and match_source = 'auto'`;
  const c = row ? readCandidates(row.match_candidates)[index] : undefined;
  if (!c || candidateKey(c) !== key) return { changed: false };
  // A music candidate's art arrives through the lane's art-only tail (Cover Art Archive), never from this request.
  const artRetry = c.imageUrl ? undefined : c.releaseGroupId;
  // ifCandidates: the write lands only while the list is still the one just read (no read-then-write race).
  const changed = await saveMatch(id, { ...c, matchConfidence: 1, artRetry },
    { ownerPick: candidateKey(c), ifCandidates: JSON.stringify(row!.match_candidates) });
  if (changed) await applyReviewReason(id);
  return { changed };
}

/** None of these: final. The tip stays (or becomes) no_match, so it is still in review, and the lane never looks again. */
export async function noneOfThese(id: number): Promise<{ changed: boolean }> {
  const rows = await db()`update recommendations set owner_none_at = now(), match_source = 'owner',
      enrichment_status = 'no_match', enriched_at = coalesce(enriched_at, now()), updated_at = now()
    where id = ${id} and match_source = 'auto' and owner_none_at is null and enrichment_status in ('no_match', 'pending')
      and status <> all(${SWEEP_SKIPS_STATUSES}::text[])
    returning id`;
  if (rows.length > 0) await applyReviewReason(id);
  return { changed: rows.length > 0 };
}

export type SearchResult =
  | { status: "ok"; found: number }
  | { status: "refused"; reason: "too_soon" | "not_configured" | "busy" | "gone" | "failed" };

export interface SearchDeps { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch }

/** The type's provider; music: MusicBrainz and Apple together, as the lane does (decision 050). Each tagged with its provider. */
export async function searchCandidates(
  provider: NamedProvider, q: EnrichQuery, env: Record<string, string | undefined>, fetchImpl: typeof fetch,
): Promise<StoredCandidate[]> {
  const found = provider.name === "musicbrainz"
    ? await searchMusic(q, fetchImpl, appleAccess(env)) // nothing found and a 503/429: "try again in a bit"
    : await runProvider(provider.def, q, fetchImpl);
  return found.map((c) => ({ provider: provider.name, ...c }));
}

/** Search again: candidates replaced, nothing picked. A pending tip becomes no_match so the lane can't overwrite them. */
export async function searchAgain(id: number, query: string, deps: SearchDeps = {}): Promise<SearchResult> {
  const env = deps.env ?? process.env;
  const [tip] = await db()`select type, lat, lng, said_lat, said_lng from recommendations
    where id = ${id} and match_source = 'auto' and status <> all(${SWEEP_SKIPS_STATUSES}::text[])`;
  if (!tip) return { status: "refused", reason: "gone" };
  const provider = tip.type === "video" ? null : providerFor(tip.type as RecType, env); // video's oEmbed reads a URL, it can't search
  if (!provider) return { status: "refused", reason: "not_configured" };
  // The rate limit, race-free: one statement claims the slot or doesn't.
  const claimed = await db()`update recommendations set candidates_at = now()
    where id = ${id} and (candidates_at is null or candidates_at < now() - make_interval(secs => ${SEARCH_EVERY_SECONDS}))
    returning id`;
  if (claimed.length === 0) return { status: "refused", reason: "too_soon" };

  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const bias = biasFor({ saidLat: num(tip.said_lat), saidLng: num(tip.said_lng), lat: num(tip.lat), lng: num(tip.lng) }, env);
  // creator null: the owner's words are the whole search (the old creator may belong to the wrong match)
  const q: EnrichQuery = { type: tip.type as RecType, name: query, creator: null, lat: bias?.lat ?? null, lng: bias?.lng ?? null };
  try {
    const found = await searchCandidates(provider, q, env, deps.fetchImpl ?? fetch);
    await db()`update recommendations set match_candidates = ${JSON.stringify(found)}::jsonb,
        enrichment_status = case when enrichment_status = 'pending' then 'no_match' else enrichment_status end,
        enriched_at = coalesce(enriched_at, now()), updated_at = now()
      where id = ${id} and match_source = 'auto'`;
    await applyReviewReason(id);
    return { status: "ok", found: found.length };
  } catch (err) {
    logEnrichError("which-one search", { rec: id }, err);
    return { status: "refused", reason: isBackOffSignal(err) ? "busy" : "failed" };
  }
}
