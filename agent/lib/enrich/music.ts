import { appleAccess, appleMusicSearch, logAppleSkippedOnce, sameAsMatch, type AppleAccess } from "./apple-music";
import { pickMatch } from "./match";
import { coverArtUrl, musicBrainzProvider } from "./musicbrainz";
import { logEnrichError, runProvider, type EnrichmentMatch, type EnrichQuery } from "./types";

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
    return m;
  }
};

const appleMusic: MusicAddOn = async (m, input, deps) => {
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
// Discogs seam (later, DISCOGS_TOKEN): label, year, pressing, credits → append a `discogs` add-on here.
export const MUSIC_ADDONS: readonly MusicAddOn[] = [coverArt, appleMusic];

// Albums, songs, artists: MusicBrainz identity (keyless) → Jev picks or abstains → add-ons.
// A MusicBrainz failure throws (ProviderHttpError/TimeoutError) so the caller can retry later; null = no match.
export async function enrichMusic(input: MusicInput, deps: Partial<MusicDeps> = {}): Promise<EnrichmentMatch | null> {
  const d: MusicDeps = {
    fetchImpl: deps.fetchImpl ?? fetch,
    pick: deps.pick ?? pickMatch,
    apple: deps.apple === undefined ? appleAccess() : deps.apple,
  };
  const candidates = await runProvider(musicBrainzProvider, input.query, d.fetchImpl);
  const match = await d.pick({ described: input.described, excerpt: input.excerpt }, candidates);
  if (!match) return null;
  let m = match;
  for (const addOn of MUSIC_ADDONS) m = await addOn(m, input, d);
  return m;
}
