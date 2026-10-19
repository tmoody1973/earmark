import { appleAccess, appleMusicSearch, logAppleSkippedOnce, sameAsMatch, type AppleAccess } from "./apple-music";
import { pickMatch } from "./match";
import { coverArtUrl, musicBrainzProvider } from "./musicbrainz";
import { logEnrichError, runProvider, type Candidate, type EnrichmentMatch, type EnrichQuery } from "./types";

export interface MusicDeps {
  fetchImpl: typeof fetch;
  pick: typeof pickMatch;
  apple: AppleAccess | null; // null = not configured → skipped
}
interface MusicInput { recId: number | null; query: EnrichQuery; described: string; excerpt: string }

// An add-on decorates a match MusicBrainz + Jev already settled. It must not throw: a failed add-on keeps the match.
type MusicAddOn = (m: EnrichmentMatch, input: MusicInput, deps: MusicDeps) => Promise<EnrichmentMatch>;

const coverArt: MusicAddOn = async (m, input, deps) => {
  if (m.imageUrl || !m.releaseGroupId) return m;
  try {
    const imageUrl = await coverArtUrl(m.releaseGroupId, deps.fetchImpl);
    return imageUrl ? { ...m, imageUrl } : m;
  } catch (err) {
    logEnrichError("cover-art", { rec: input.recId, mbid: m.releaseGroupId }, err);
    return { ...m, artRetry: m.releaseGroupId }; // getJson answers 404 with null, so this is a 5xx or timeout
  }
};

export const appleMusic: MusicAddOn = async (m, input, deps) => {
  if (!deps.apple) {
    logAppleSkippedOnce();
    return m;
  }
  try {
    const query = { ...input.query, name: m.canonicalName, creator: m.creator };
    const hit = (await runProvider(appleMusicSearch(deps.apple), query, deps.fetchImpl)).find((a) => sameAsMatch(m, a));
    if (!hit) return m;
    return { ...m, appleMusicId: hit.appleMusicId, links: { ...m.links, ...hit.links }, imageUrl: m.imageUrl ?? hit.imageUrl };
  } catch (err) {
    logEnrichError("apple-music", { rec: input.recId, mbid: m.mbid }, err);
    return m;
  }
};

// Order matters: Cover Art Archive first (keyless), then Apple (fills art only when CAA had none).
// Discogs (label, year, credits) is not an add-on here: it is the 2-4 calls of the tip page extras step (extras.ts,
// decision 047), where a 429 stops the step without burning a try. scripts/refresh-music-addons.ts backfills both.
export const MUSIC_ADDONS: readonly MusicAddOn[] = [coverArt, appleMusic];

// Apple Music's catalog as a second search (decision 050), each candidate tagged so "Which one?" stores where it came from.
export async function appleCandidates(apple: AppleAccess, q: EnrichQuery, fetchImpl: typeof fetch): Promise<Candidate[]> {
  return (await runProvider(appleMusicSearch(apple), q, fetchImpl)).map((c) => ({ ...c, provider: "apple" }));
}

// Albums, songs, artists: MusicBrainz identity (keyless) → Jev picks or abstains → add-ons. No accepted pick (nothing
// found, or Jev abstained) and Apple configured: Apple's catalog → the same Jev pick, same bar; an Apple pick skips the
// add-ons (no mbid for Cover Art, Apple's art and link already on it). A new independent release (MettaSun, tip 150) is
// often on Apple before MusicBrainz.
// A MusicBrainz failure throws (ProviderHttpError/TimeoutError) so the caller can retry later; an Apple failure in the
// fallback is no match for this try (logged). null = no match.
export async function enrichMusic(input: MusicInput, deps: Partial<MusicDeps> = {}): Promise<EnrichmentMatch | null> {
  const d: MusicDeps = {
    fetchImpl: deps.fetchImpl ?? fetch,
    pick: deps.pick ?? pickMatch,
    apple: deps.apple === undefined ? appleAccess() : deps.apple,
  };
  const said = { described: input.described, excerpt: input.excerpt };
  const candidates = await runProvider(musicBrainzProvider, input.query, d.fetchImpl);
  const match = await d.pick(said, candidates);
  if (!match) {
    if (!d.apple) return null;
    let found: Candidate[];
    try {
      found = await appleCandidates(d.apple, input.query, d.fetchImpl);
    } catch (err) {
      logEnrichError("apple-music", { rec: input.recId }, err);
      return null;
    }
    return d.pick(said, found); // a Jev failure still throws, as on MusicBrainz's candidates
  }
  let m = match;
  for (const addOn of MUSIC_ADDONS) m = await addOn(m, input, d);
  return m;
}
