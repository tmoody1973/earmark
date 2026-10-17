// Video tips (add-on; adapted from bot PR #10). KEYLESS: YouTube oEmbed, only when the tip carries a video URL (an
// emailed tip keeps its links; a photo or a spoken tip has none).
//   GET https://www.youtube.com/oembed?url={video url}&format=json → { title, author_name, thumbnail_url, html, … }
//   oEmbed spec: https://oembed.com/ (YouTube is a listed provider, endpoint https://www.youtube.com/oembed).
//   400/404 = no such video; 401/403 = private or not embeddable. We never store or render `html` (no embed, no play).
// A spoken title alone runs no search (the Data API needs a key): the tip gets a YouTube search link as
// links.primary, no image, and the card shows its designed no-image state. No Jev call either way: a URL names the
// video exactly, and a search link identifies nothing to confirm.
// SEAM youtubeDataApiSearch(YOUTUBE_API_KEY): with a key, search.list
// (https://developers.google.com/youtube/v3/docs/search/list) → candidates → Jev picks, like every other provider.
// Not built: add it in enrichVideo's no-URL branch when the key exists.
import { getJson, ProviderHttpError, USER_AGENT, type EnrichmentMatch, type EnrichQuery, type ProviderDef } from "./types";

const VIDEO_URL = /^https?:\/\/(?:(?:www\.|m\.)?youtube\.com\/(?:watch\?|shorts\/|live\/)|youtu\.be\/)\S+$/i;
const HEADERS = { headers: { "User-Agent": USER_AGENT } };

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
    const thumb = typeof j.thumbnail_url === "string" && /^https:\/\//.test(j.thumbnail_url) ? j.thumbnail_url : null;
    return [{
      canonicalName: title.slice(0, 120),
      creator: typeof j.author_name === "string" && j.author_name.trim() ? j.author_name.trim().slice(0, 80) : null,
      yearOrAddress: null, imageUrl: thumb, links: { youtube: q.url },
    }];
  },
};

/** One video tip → a match (always; nothing here asks Jev). Throws only on a busy or broken YouTube (lane backs off). */
export async function enrichVideo(q: EnrichQuery, fetchImpl: typeof fetch = fetch): Promise<EnrichmentMatch> {
  const plain = { canonicalName: q.name, creator: q.creator, yearOrAddress: null, imageUrl: null };
  // matchConfidence 0: a search link identifies nothing (the tip is still "matched": its link is all a keyless lane can add)
  if (!q.url) return { ...plain, matchConfidence: 0, links: { primary: youtubeSearchUrl(q.name, q.creator) } };
  const { url, init } = await youtubeOEmbedProvider.build(q);
  let json: unknown = null;
  try {
    json = await getJson(url, init, fetchImpl);
  } catch (err) {
    if (!(err instanceof ProviderHttpError && (err.status === 401 || err.status === 403))) throw err;
  }
  const [hit] = json === null ? [] : youtubeOEmbedProvider.parse(json, q);
  return { ...(hit ?? { ...plain, links: { youtube: q.url } }), matchConfidence: 1 }; // the URL names the video exactly
}
