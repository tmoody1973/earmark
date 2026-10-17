// Video tips (add-on; adapted from bot PR #10). KEYLESS: YouTube oEmbed, only when the tip carries a video URL (an
// emailed tip keeps its links; a photo or a spoken tip has none).
//   GET https://www.youtube.com/oembed?url={video url}&format=json → { title, author_name, thumbnail_url, html, … }
//   oEmbed spec: https://oembed.com/ (YouTube is a listed provider, endpoint https://www.youtube.com/oembed).
//   400/404 = no such video; 401/403 = private or not embeddable. We never store or render `html` (no embed, no play).
//   The body is read to at most 64 KB; the thumbnail is kept only from i.ytimg.com.
// No Jev call either way. Only an oEmbed answer confirms the video (matchConfidence 1). Everything else is a link only
// (matchConfidence 0, under MATCH_ACCEPT): the lane files it as no_match, so it reaches review, and still keeps the link:
//  - a spoken title runs no search (the Data API needs a key): links.primary = a YouTube search, or a TikTok search
//    when the excerpt says TikTok; no image, so the card shows its designed no-image state;
//  - a URL that oEmbed can't confirm (removed, private, oversized answer): links.youtube = that URL.
// SEAM youtubeDataApiSearch(YOUTUBE_API_KEY): with a key, search.list
// (https://developers.google.com/youtube/v3/docs/search/list) → candidates → Jev picks, like every other provider.
// Not built: add it in enrichVideo's no-URL branch when the key exists.
import { PROVIDER_TIMEOUT_MS, ProviderHttpError, USER_AGENT, type EnrichmentMatch, type EnrichQuery, type ProviderDef } from "./types";

const VIDEO_URL = /^https?:\/\/(?:(?:www\.|m\.)?youtube\.com\/(?:watch\?|shorts\/|live\/)|youtu\.be\/)\S+$/i;
const THUMB_URL = /^https:\/\/i\.ytimg\.com\//;
const HEADERS = { headers: { "User-Agent": USER_AGENT } };
export const MAX_OEMBED_BYTES = 64 * 1024;
const NO_DATA = new Set([400, 401, 403, 404]);

/** The first YouTube video link among a tip's stored links (strings, or lists like an email's `urls`), as https. Pure. */
export function youtubeVideoUrl(links: unknown): string | null {
  if (!links || typeof links !== "object") return null;
  const found = Object.values(links).flat().find((v): v is string => typeof v === "string" && VIDEO_URL.test(v));
  return found ? found.replace(/^http:/i, "https:") : null;
}

export function youtubeSearchUrl(name: string, channel: string | null): string {
  const q = channel ? `${name} ${channel}` : name;
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
}

export const tiktokSearchUrl = (name: string) => `https://www.tiktok.com/search?q=${encodeURIComponent(name)}`;

// Registered under "youtube" (registry.ts). Needs q.url: enrichVideo never builds it without one.
export const youtubeOEmbedProvider: ProviderDef = {
  async build(q: EnrichQuery) {
    if (!q.url) throw new Error("youtube oEmbed needs a video url");
    return { url: `https://www.youtube.com/oembed?url=${encodeURIComponent(q.url)}&format=json`, init: HEADERS };
  },
  parse(json, q) {
    const j = json as { title?: unknown; author_name?: unknown; thumbnail_url?: unknown };
    const title = typeof j.title === "string" && j.title.trim() ? j.title.trim() : null;
    if (!title || !q.url) return [];
    return [{
      canonicalName: title.slice(0, 120),
      creator: typeof j.author_name === "string" && j.author_name.trim() ? j.author_name.trim().slice(0, 80) : null,
      yearOrAddress: null, imageUrl: typeof j.thumbnail_url === "string" && THUMB_URL.test(j.thumbnail_url) ? j.thumbnail_url : null,
      links: { youtube: q.url },
    }];
  },
};

// getJson, but the body is read to at most `max` bytes (an oversized answer is no data, not an error: it won't shrink).
async function getCappedJson(url: string, init: RequestInit, fetchImpl: typeof fetch, max = MAX_OEMBED_BYTES): Promise<unknown | null> {
  const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
  if (NO_DATA.has(res.status)) return null;
  if (!res.ok) throw new ProviderHttpError(new URL(url).host, res.status);
  const reader = res.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

/** One video tip → its links (always; nothing here asks Jev). Throws only on a busy or broken YouTube (lane backs off). */
export async function enrichVideo(q: EnrichQuery, excerpt: string, fetchImpl: typeof fetch = fetch): Promise<EnrichmentMatch> {
  const linkOnly = { canonicalName: q.name, creator: q.creator, yearOrAddress: null, imageUrl: null, matchConfidence: 0 };
  if (!q.url) {
    const primary = /tiktok/i.test(excerpt) ? tiktokSearchUrl(q.name) : youtubeSearchUrl(q.name, q.creator);
    return { ...linkOnly, links: { primary } };
  }
  const { url, init } = await youtubeOEmbedProvider.build(q);
  const json = await getCappedJson(url, init, fetchImpl);
  const [hit] = json === null ? [] : youtubeOEmbedProvider.parse(json, q);
  return hit ? { ...hit, matchConfidence: 1 } : { ...linkOnly, links: { youtube: q.url } };
}
