import { appleMusicConfig, getDeveloperToken } from "../music/developer-token";
import { type Candidate, type EnrichmentMatch, type EnrichQuery, type ProviderDef } from "./types";

// Apple Music catalog search. GET /v1/catalog/{storefront}/search?types=&term= (spaces as +), Bearer developer token;
// results.{albums|songs|artists}.data[].attributes; artwork.url is a {w}x{h} template.
// Sources: docs/research/integrations.md §1, https://developer.apple.com/documentation/applemusicapi/search-for-catalog-resources-(by-type)
export const APPLE_BASE = "https://api.music.apple.com/v1";
const KEY = { album: "albums", song: "songs", artist: "artists" } as const;
type MusicType = keyof typeof KEY;

export interface AppleAccess { token(): Promise<string>; storefront: string }

// Null when the APPLE_* secrets are absent: callers skip Apple (one log line), never error.
export function appleAccess(source: Record<string, string | undefined> = process.env): AppleAccess | null {
  const cfg = appleMusicConfig(source);
  return cfg ? { token: () => getDeveloperToken(cfg), storefront: cfg.storefront } : null;
}

export function artworkUrl(template: string | undefined, size = 600): string | null {
  return template ? template.replace("{w}", String(size)).replace("{h}", String(size)) : null;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped external JSON, read defensively */
export function appleMusicSearch(access: AppleAccess): ProviderDef {
  return {
    async build(q) {
      const term = [q.name, q.creator].filter(Boolean).join(" ");
      const url = `${APPLE_BASE}/catalog/${access.storefront}/search?types=${KEY[q.type as MusicType]}&limit=3` +
        `&term=${encodeURIComponent(term).replace(/%20/g, "+")}`;
      return { url, init: { headers: { Authorization: `Bearer ${await access.token()}` } } };
    },
    parse: parseAppleSearch,
  };
}

export function parseAppleSearch(json: unknown, q: EnrichQuery): Candidate[] {
  const data: any[] = (json as any)?.results?.[KEY[q.type as MusicType]]?.data ?? [];
  return data.filter((d) => d?.id && d.attributes?.name).map((d): Candidate => ({
    canonicalName: d.attributes.name,
    creator: q.type === "artist" ? null : d.attributes.artistName ?? null,
    yearOrAddress: d.attributes.releaseDate ? String(d.attributes.releaseDate).slice(0, 4) : null,
    imageUrl: artworkUrl(d.attributes.artwork?.url),
    links: d.attributes.url ? { apple_music: d.attributes.url } : {},
    appleMusicId: String(d.id),
  }));
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export const norm = (s: string | null | undefined) => (s ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Apple adds links to an identity MusicBrainz already settled, so no second Jev call: an Apple result is attached only
// when its name and artist equal the match's (normalised). ponytail: exact-name equality; ISRC/UPC lookup
// (filter[isrc] / filter[upc]) is the upgrade path if real data shows misses.
export function sameAsMatch(m: EnrichmentMatch, a: Candidate): boolean {
  return norm(a.canonicalName) === norm(m.canonicalName) && (m.creator === null || norm(a.creator) === norm(m.creator));
}

let skipLogged = false;
export function logAppleSkippedOnce(): void {
  if (skipLogged) return;
  skipLogged = true;
  console.log("skipped: apple music not configured");
}
/** Test-only. */
export function resetAppleSkipLog(): void {
  skipLogged = false;
}
