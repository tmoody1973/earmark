import { appleAccess, appleMusicSearch, logAppleSkippedOnce, sameAsMatch, type AppleAccess } from "./apple-music";
import { pickMatch } from "./match";
import { coverArtUrl, musicBrainzProvider } from "./musicbrainz";
import { logEnrichError, MAX_CANDIDATES, runProvider, type Candidate, type EnrichmentMatch, type EnrichQuery } from "./types";

export interface MusicDeps {
  fetchImpl: typeof fetch;
  pick: typeof pickMatch;
  apple: AppleAccess | null; // null = not configured → skipped
}
interface MusicInput { recId: number | null; query: EnrichQuery; described: string; excerpt: string }

// An add-on decorates a match the searches + Jev already settled. It must not throw: a failed add-on keeps the match.
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
  if (m.appleMusicId) return m; // the pick already carries Apple's identity (decision 050)
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

// Order matters: Cover Art Archive first (keyless), then Apple (fills art only when CAA had none). A pick that came from
// Apple, or merged with its Apple twin, already has Apple's art when it has any, so Cover Art only fills a gap.
// Discogs (label, year, credits) is not an add-on here: it is the 2-4 calls of the tip page extras step (extras.ts,
// decision 047), where a 429 stops the step without burning a try. scripts/refresh-music-addons.ts backfills both.
export const MUSIC_ADDONS: readonly MusicAddOn[] = [coverArt, appleMusic];

// The same release from both is one candidate with both identities (Apple's art only where MusicBrainz has none).
// Jev's list: merged first, then MusicBrainz and Apple alternating, at most MAX_CANDIDATES. Pure.
export function mergeMusic(mb: readonly Candidate[], apple: readonly Candidate[]): Candidate[] {
  const unmatched = [...apple];
  const both: Candidate[] = [];
  const mbOnly: Candidate[] = [];
  for (const m of mb) {
    const i = unmatched.findIndex((a) => sameAsMatch(m, a));
    if (i < 0) {
      mbOnly.push(m);
      continue;
    }
    const [a] = unmatched.splice(i, 1);
    both.push({ ...m, appleMusicId: a!.appleMusicId, links: { ...m.links, ...a!.links }, imageUrl: m.imageUrl ?? a!.imageUrl, provider: "musicbrainz+apple" });
  }
  const appleOnly = unmatched.map((a) => ({ ...a, provider: "apple" }));
  const alternating = Array.from({ length: Math.max(mbOnly.length, appleOnly.length) }, (_, i) => [mbOnly[i], appleOnly[i]]).flat();
  return [...both, ...alternating.filter((c): c is Candidate => !!c)].slice(0, MAX_CANDIDATES);
}

// MusicBrainz and (when configured) Apple's catalog, searched together (decision 050). One failing never discards the
// other's candidates (the failure is logged); a failure is thrown, for the caller's retry or back-off, only when nothing
// was found at all, MusicBrainz's first. Apple not configured: MusicBrainz alone, exactly as before.
export async function searchMusic(q: EnrichQuery, fetchImpl: typeof fetch, apple: AppleAccess | null, recId: number | null = null): Promise<Candidate[]> {
  const [mb, ap] = await Promise.allSettled([
    runProvider(musicBrainzProvider, q, fetchImpl),
    apple ? runProvider(appleMusicSearch(apple), q, fetchImpl) : Promise.resolve([]),
  ]);
  const mbFound = mb.status === "fulfilled" ? mb.value : [];
  const appleFound = ap.status === "fulfilled" ? ap.value : [];
  if (mbFound.length + appleFound.length === 0) {
    if (mb.status === "rejected") throw mb.reason;
    if (ap.status === "rejected") throw ap.reason;
  }
  if (mb.status === "rejected") logEnrichError("musicbrainz", { rec: recId }, mb.reason);
  if (ap.status === "rejected") logEnrichError("apple-music", { rec: recId }, ap.reason);
  return mergeMusic(mbFound, appleFound);
}

// Albums, songs, artists: MusicBrainz and Apple together (searchMusic) → Jev picks once or abstains → add-ons. Apple's
// catalog often has a new independent release before MusicBrainz does (MettaSun, tip 150).
// Throws (ProviderHttpError/TimeoutError) only when no search found anything and one failed, so the caller can retry
// later; null = no match.
export async function enrichMusic(input: MusicInput, deps: Partial<MusicDeps> = {}): Promise<EnrichmentMatch | null> {
  const d: MusicDeps = {
    fetchImpl: deps.fetchImpl ?? fetch,
    pick: deps.pick ?? pickMatch,
    apple: deps.apple === undefined ? appleAccess() : deps.apple,
  };
  const candidates = await searchMusic(input.query, d.fetchImpl, d.apple, input.recId);
  const match = await d.pick({ described: input.described, excerpt: input.excerpt }, candidates);
  if (!match) return null;
  let m = match;
  for (const addOn of MUSIC_ADDONS) m = await addOn(m, input, d);
  return m;
}
