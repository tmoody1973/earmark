import { createHash } from "node:crypto";
import { MAX_CANDIDATES, USER_AGENT, type Candidate, type ProviderDef } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped external JSON, read defensively */

// Podcast Index (keyed: PODCAST_INDEX_KEY + PODCAST_INDEX_SECRET). GET /api/1.0/search/byterm?q=&max=; headers
// X-Auth-Key, X-Auth-Date (unix seconds, 3-minute window), Authorization = hex sha1(key + secret + date), User-Agent.
// Docs: https://podcastindex-org.github.io/docs-api/#auth , https://podcastindex-org.github.io/docs-api/#get-/search/byterm
export function podcastIndexHeaders(key: string, secret: string, nowSec = Math.floor(Date.now() / 1000)) {
  const date = String(nowSec);
  return {
    "User-Agent": USER_AGENT,
    "X-Auth-Key": key,
    "X-Auth-Date": date,
    Authorization: createHash("sha1").update(key + secret + date).digest("hex"),
  };
}

export function podcastIndexProvider(key: string, secret: string): ProviderDef {
  return {
    async build(q) {
      return {
        url: `https://api.podcastindex.org/api/1.0/search/byterm?q=${encodeURIComponent(q.name)}&max=${MAX_CANDIDATES}`,
        init: { headers: podcastIndexHeaders(key, secret) },
      };
    },
    parse(json) {
      const feeds: any[] = (json as any)?.feeds ?? [];
      return feeds.filter((f) => f?.id && f.title).map((f): Candidate => ({
        canonicalName: f.title,
        creator: f.author || f.ownerName || null,
        yearOrAddress: null,
        imageUrl: f.artwork || f.image || null,
        links: { podcast_index: `https://podcastindex.org/podcast/${f.id}` },
      }));
    },
  };
}

// Keyless fallback until Podcast Index keys exist (decision 013): the iTunes Search API, podcasts only.
// GET https://itunes.apple.com/search?term=&media=podcast&entity=podcast&limit= → results[].{collectionName,
// artistName, artworkUrl600, collectionViewUrl}. Apple documents ~20 calls/minute.
// Docs: https://performance-partners.apple.com/search-api (iTunes Search API)
export const itunesPodcastProvider: ProviderDef = {
  async build(q) {
    return {
      url: `https://itunes.apple.com/search?term=${encodeURIComponent(q.name)}&media=podcast&entity=podcast&limit=${MAX_CANDIDATES}`,
      init: { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } },
    };
  },
  parse(json) {
    const results: any[] = (json as any)?.results ?? [];
    return results.filter((r) => r?.collectionName && r.collectionViewUrl).map((r): Candidate => ({
      canonicalName: r.collectionName,
      creator: r.artistName ?? null,
      yearOrAddress: null,
      imageUrl: r.artworkUrl600 || r.artworkUrl100 || null,
      links: { apple_podcasts: String(r.collectionViewUrl).split("?")[0]! }, // drop the ?uo= tracking param
    }));
  },
};
/* eslint-enable @typescript-eslint/no-explicit-any */
