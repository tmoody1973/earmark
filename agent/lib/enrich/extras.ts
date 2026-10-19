// Tip page extras (decision 045): a little more about a matched tip, fetched ONCE by the rec lane (lane.ts writeExtras),
// stored on recommendations.extras, and never fetched when the page loads. All keyless; one try per request, no retries.
//  - song/album: iTunes Search API (https://performance-partners.apple.com/search-api). With an Apple Music id:
//    GET /lookup?id=&entity=song&limit=1&country=us (a song's track, or an album's collection then its first track).
//    Without: GET /search?term=&entity=song|album&limit=1&country=us, kept only when name and artist fit; an album hit
//    carries no previewUrl, so its first track comes from /lookup?id=<collectionId>&entity=song&limit=1.
//    Apple's terms for previews: streamed only (we store the URL, never the audio), shown next to a link to the store,
//    with "provided courtesy of iTunes" (the page does both).
//  - podcast: /lookup?id=<Apple Podcasts id> (or /search?media=podcast) → feedUrl → the RSS (https to a public host only, at most
//    3 redirects each re-checked, 10 s, first 1 MB; a feed's failure counts a try, never a back-off) → the
//    newest 3 audio episodes.
//  - video: the YouTube id from the stored link; no request.
//  - book: the Open Library work JSON (description, first_publish_date) and search.json for number_of_pages_median.
//  - anything with a Wikipedia about_url (lane.ts about step): the page summary's extract, up to 600 characters.
//  - place: nothing (the other lane fills lat/lng; the address is already the tip's year_or_address).
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import type { RecType } from "../types";
import { norm } from "./apple-music";
import { fetchDiscogsSoft, logDiscogsSkippedOnce, readDiscogs, type DiscogsAccess, type DiscogsExtras } from "./discogs";
import { getJson, USER_AGENT } from "./types";
import { youtubeVideoUrl } from "./youtube";

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped external JSON, read defensively */

export const EXTRAS_TEXT_MAX = 600;
export const MAX_EPISODES = 3;
export const RSS_TIMEOUT_MS = 10_000;
export const RSS_MAX_BYTES = 1024 * 1024;

export interface Episode { title: string; date: string | null; audioUrl: string }
export interface RecExtras {
  preview?: { audioUrl: string; appleUrl: string };
  episodes?: Episode[];
  videoId?: string;
  book?: { description: string | null; firstPublished: string | null; pages: number | null };
  wiki?: { text: string; url: string };
  discogs?: DiscogsExtras; // albums, songs, artists (decision 047); its url is also copied to links.discogs
}
export interface ExtrasRec {
  type: RecType; canonical_name: string; creator: string | null; apple_music_id: string | null; links: unknown; about_url: string | null;
}

const WIKI = "https://en.wikipedia.org/wiki/";
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const HEADERS = { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } };

/** Web URLs only, always https (a page never loads mixed content or a script URL). */
const https = (v: unknown): string | null => (typeof v === "string" && /^https?:\/\/\S+$/i.test(v) ? v.replace(/^http:/i, "https:") : null);
const noTracking = (url: string) => url.replace(/[?&]uo=\d+$/, "");

/** Whitespace collapsed, at most `max` characters, cut at a word with an ellipsis. Pure. */
export function trimText(s: string, max = EXTRAS_TEXT_MAX): string | null {
  const text = s.replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (text.length <= max) return text;
  const head = text.slice(0, max - 1);
  return `${head.slice(0, head.lastIndexOf(" ") > 0 ? head.lastIndexOf(" ") : head.length).replace(/[\s.,;:!?…—–-]+$/u, "")}…`;
}

// "Movement 1" fits "Movement 1 (feat. …)", "Floating Points" fits "Floating Points & Pharoah Sanders"; nothing looser.
const fits = (found: unknown, ours: string | null) => {
  const a = norm(typeof found === "string" ? found : "");
  const b = norm(ours);
  return !!a && !!b && (a === b || a.startsWith(`${b} `) || b.startsWith(`${a} `));
};
const artistFits = (found: unknown, creator: string | null) => creator === null || fits(found, creator);

/**
 * An iTunes search or lookup answer → the preview to store. A song: its track. An album: the collection's link and its
 * first track's preview, or (a search hit has no track) the collection id to look the track up by. Pure.
 */
export function pickItunesPreview(json: unknown, rec: Pick<ExtrasRec, "canonical_name" | "creator">, kind: "song" | "album"):
  { audioUrl: string; appleUrl: string } | { audioUrl: null; appleUrl: string; collectionId: number } | null {
  const results: any[] = Array.isArray((json as any)?.results) ? (json as any).results : [];
  if (kind === "song") {
    const t = results.find((r) => r?.wrapperType === "track");
    if (!t || !fits(t.trackName, rec.canonical_name) || !artistFits(t.artistName, rec.creator)) return null;
    const [audioUrl, appleUrl] = [https(t.previewUrl), https(t.trackViewUrl)];
    return audioUrl && appleUrl ? { audioUrl, appleUrl: noTracking(appleUrl) } : null;
  }
  const c = results.find((r) => r?.wrapperType === "collection");
  if (!c || !fits(c.collectionName, rec.canonical_name) || !artistFits(c.artistName, rec.creator)) return null;
  const appleUrl = https(c.collectionViewUrl);
  if (!appleUrl) return null;
  const audioUrl = results.filter((r) => r?.wrapperType === "track").map((r) => https(r.previewUrl)).find(Boolean);
  if (audioUrl) return { audioUrl, appleUrl: noTracking(appleUrl) };
  return Number.isSafeInteger(c.collectionId) ? { audioUrl: null, appleUrl: noTracking(appleUrl), collectionId: c.collectionId } : null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
  if (e[0] !== "#") return ENTITIES[e.toLowerCase()] ?? m;
  const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
  return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
});
const tagText = (item: string, tag: string) => {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(item)?.[1];
  if (m === undefined) return null;
  const raw = m.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  return trimText(decode(raw.replace(/<[^>]*>/g, " ")).replace(/<[^>]*>/g, " "), 200);
};
/** One attribute of one tag, decoded ("" when absent). Either quote; the other quote may sit inside ("Sun Ra's"). Pure. */
export const attr = (tag: string, name: string) => {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag);
  return decode(m?.[1] ?? m?.[2] ?? "");
};

/**
 * A podcast feed → its newest audio episodes. Regex, not a parser (no new dependency): complete <item> blocks only, so a
 * feed cut off by the byte cap still yields what arrived. Newest first by pubDate (undated last). Pure.
 */
export function latestEpisodes(xml: string, max = MAX_EPISODES): Episode[] {
  const out: Episode[] = [];
  for (const [item] of xml.matchAll(/<item[\s>][\s\S]*?<\/item>/g)) {
    const enclosure = /<enclosure\b[^>]*>/.exec(item)?.[0];
    const type = enclosure ? attr(enclosure, "type") : "";
    const audioUrl = enclosure ? https(attr(enclosure, "url")) : null;
    const title = tagText(item, "title");
    if (!audioUrl || !title || (type && !type.startsWith("audio/"))) continue;
    const ms = Date.parse(tagText(item, "pubDate") ?? "");
    out.push({ title, date: Number.isNaN(ms) ? null : new Date(ms).toISOString(), audioUrl });
  }
  return out.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")).slice(0, max);
}

/** Open Library work JSON (+ its search.json doc) → what the page shows. description is a string or {type, value}. Pure. */
export function bookFromOpenLibrary(work: unknown, search: unknown): RecExtras["book"] | null {
  const w = work as any;
  const doc = (search as any)?.docs?.[0];
  const raw = typeof w?.description === "string" ? w.description : w?.description?.value;
  const description = typeof raw === "string" ? trimText(raw) : null;
  const year = Number.isInteger(doc?.first_publish_year) ? String(doc.first_publish_year) : null;
  const firstPublished = typeof w?.first_publish_date === "string" && w.first_publish_date.trim() ? w.first_publish_date.trim() : year;
  const pages = Number.isInteger(doc?.number_of_pages_median) && doc.number_of_pages_median > 0 ? doc.number_of_pages_median : null;
  return description || firstPublished || pages ? { description, firstPublished, pages } : null;
}

/** Wikipedia page summary → the longer extract, standard pages only. Pure. */
export function wikiExtract(summary: unknown, url: string): RecExtras["wiki"] | null {
  const s = summary as any;
  const text = s?.type === "standard" && typeof s.extract === "string" ? trimText(s.extract) : null;
  return text ? { text, url } : null;
}

/** The 11-character id of a YouTube watch / youtu.be / shorts / live link. Pure. */
export function youtubeId(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const id = u.hostname.endsWith("youtu.be") ? u.pathname.slice(1) : u.searchParams.get("v") ?? u.pathname.split("/")[2];
    return id && VIDEO_ID.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** The stored jsonb, as far as the page may trust it: web URLs only, every part the right shape. Pure. */
export function readExtras(raw: unknown): RecExtras {
  const x = raw as any;
  const out: RecExtras = {};
  if (!x || typeof x !== "object") return out;
  const [audio, apple] = [https(x.preview?.audioUrl), https(x.preview?.appleUrl)];
  if (audio && apple) out.preview = { audioUrl: audio, appleUrl: apple };
  const episodes = Array.isArray(x.episodes) ? x.episodes.flatMap((e: any): Episode[] => {
    const audioUrl = https(e?.audioUrl);
    const date = typeof e?.date === "string" ? e.date : null;
    if (date !== null && Number.isNaN(Date.parse(date))) return []; // the page formats it: a non-date would throw
    return audioUrl && typeof e.title === "string" ? [{ title: e.title, date, audioUrl }] : [];
  }) : [];
  if (episodes.length) out.episodes = episodes.slice(0, MAX_EPISODES);
  if (typeof x.videoId === "string" && VIDEO_ID.test(x.videoId)) out.videoId = x.videoId;
  const b = x.book;
  if (b && typeof b === "object") {
    const str = (v: unknown) => (typeof v === "string" && v ? v : null);
    const book = { description: str(b.description), firstPublished: str(b.firstPublished), pages: Number.isInteger(b.pages) ? b.pages : null };
    if (book.description || book.firstPublished || book.pages) out.book = book;
  }
  if (typeof x.wiki?.text === "string" && typeof x.wiki.url === "string" && x.wiki.url.startsWith(WIKI)) out.wiki = { text: x.wiki.text, url: x.wiki.url };
  const discogs = readDiscogs(x.discogs);
  if (discogs) out.discogs = discogs;
  return out;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * A feed URL we may fetch: https to a public-looking host name. No IP literals at all (v4 in any spelling, since URL
 * normalises "2130706433" to "127.0.0.1"; v6 in brackets), no localhost, *.local or dotless intranet names. Pure.
 * Feeds come from Apple, so the name is enough; a URL a person pasted also goes through resolvesToPublic.
 */
export function isPublicHttpsUrl(url: string): boolean {
  if (!URL.canParse(url)) return false;
  const { protocol, hostname } = new URL(url);
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return protocol === "https:" && host.includes(".") && !host.startsWith("[") && !/^[\d.]+$/.test(host)
    && host !== "localhost" && !host.endsWith(".localhost") && !host.endsWith(".local") && !host.endsWith(".internal");
}

export const MAX_FEED_REDIRECTS = 3;

// A feed is one podcaster's server, not a shared service: its failures count a try for that tip and never stop the
// step (a 503 here must not pin one dead feed at the front of the queue). Name only in logs, like ProviderHttpError.
export class FeedError extends Error {
  override name = "FeedError";
  constructor(readonly status: number) {
    super(`feed ${status}`);
  }
}

// Not a public address: private, loopback, link-local, carrier NAT, multicast/reserved; v6 loopback, unspecified,
// NAT64, unique-local, link-local, multicast. BlockList checks a v4-mapped v6 address ("::ffff:127.0.0.1") against the
// v4 rules itself (and a v4 address against v6 rules as mapped, so "::ffff:0:0/96" here would refuse every v4 address).
const NOT_PUBLIC = new BlockList();
for (const [net, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 3]] as const) NOT_PUBLIC.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [["::", 127], ["64:ff9b::", 96], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]] as const) {
  NOT_PUBLIC.addSubnet(net, prefix, "ipv6");
}

/** An IP address on the public internet (not a name: a name is never "public" here). Pure. */
export function addressIsPublic(ip: string): boolean {
  const v = isIP(ip);
  return v !== 0 && !NOT_PUBLIC.check(ip, v === 4 ? "ipv4" : "ipv6");
}

export type LookupAddresses = (host: string) => Promise<string[]>;
const dnsAddresses: LookupAddresses = async (host) => (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);

/**
 * A URL a person pasted, which we may fetch: isPublicHttpsUrl, and every address its host resolves to is public. A name
 * that doesn't resolve is refused. ponytail: the fetch resolves the name again, so a host that changes its answer in
 * between (DNS rebinding) slips past; pin the checked address in the fetch's own lookup if links ever come from anyone
 * but the owner.
 */
export async function resolvesToPublic(url: string, lookupAddresses: LookupAddresses = dnsAddresses): Promise<boolean> {
  if (!isPublicHttpsUrl(url)) return false;
  try {
    const ips = await lookupAddresses(new URL(url).hostname);
    return ips.length > 0 && ips.every(addressIsPublic);
  } catch {
    return false;
  }
}

// A page's text, at most `max` bytes (a feed's newest items and a page's <head> come first, so a cut is fine), within
// `timeoutMs` in all. Redirects are followed by hand, at most 3, each hop re-checked (`allowed`, by default
// isPublicHttpsUrl); a refused hop or 404/410 is "nothing". Another failing answer is a FeedError.
export async function getCappedText(url: string, fetchImpl: typeof fetch, opts: {
  max?: number; timeoutMs?: number; allowed?: (url: string) => boolean | Promise<boolean>;
} = {}): Promise<string | null> {
  const { max = RSS_MAX_BYTES, timeoutMs = RSS_TIMEOUT_MS, allowed = isPublicHttpsUrl } = opts;
  const signal = AbortSignal.timeout(timeoutMs);
  let res: Response | null = null;
  for (let hop = 0, at = url; hop <= MAX_FEED_REDIRECTS; hop++) {
    if (!(await allowed(at))) return null;
    res = await fetchImpl(at, { headers: { "User-Agent": USER_AGENT }, redirect: "manual", signal });
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location) break;
    if (!URL.canParse(location, at)) return null;
    at = new URL(location, at).href;
    res = null; // a redirect past the last allowed hop leaves no answer
  }
  if (!res || res.status === 404 || res.status === 410) return null;
  if (!res.ok) throw new FeedError(res.status);
  const reader = res.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < max) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  if (size >= max) await reader.cancel();
  return Buffer.concat(chunks).subarray(0, max).toString("utf8");
}

const ITUNES = "https://itunes.apple.com";
const lookupTracks = (id: string | number) => `${ITUNES}/lookup?id=${id}&entity=song&limit=1&country=us`;

async function itunesPreview(rec: ExtrasRec, kind: "song" | "album", fetchImpl: typeof fetch): Promise<RecExtras["preview"] | null> {
  const byId = rec.apple_music_id && /^\d+$/.test(rec.apple_music_id);
  const url = byId ? lookupTracks(rec.apple_music_id!)
    : `${ITUNES}/search?term=${encodeURIComponent([rec.canonical_name, rec.creator].filter(Boolean).join(" "))}&entity=${kind}&limit=1&country=us`;
  const hit = pickItunesPreview(await getJson(url, HEADERS, fetchImpl), rec, kind);
  if (!hit || !("collectionId" in hit)) return hit;
  if (byId) return null; // the lookup already listed the first track: there is no preview
  const tracks = await getJson(lookupTracks(hit.collectionId), HEADERS, fetchImpl);
  const full = pickItunesPreview(tracks, rec, "album");
  return full?.audioUrl ? { audioUrl: full.audioUrl, appleUrl: hit.appleUrl } : null;
}

async function podcastEpisodes(rec: ExtrasRec, fetchImpl: typeof fetch): Promise<Episode[]> {
  const id = /\/id(\d+)(?:[/?]|$)/.exec(String((rec.links as Record<string, unknown> | null)?.apple_podcasts ?? ""))?.[1];
  const url = id ? `${ITUNES}/lookup?id=${id}&country=us`
    : `${ITUNES}/search?term=${encodeURIComponent(rec.canonical_name)}&media=podcast&entity=podcast&limit=1&country=us`;
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped external JSON */
  const show: any = ((await getJson(url, HEADERS, fetchImpl)) as any)?.results?.[0];
  if (!show || (!id && !fits(show.collectionName, rec.canonical_name))) return [];
  const feed = typeof show.feedUrl === "string" ? show.feedUrl : null; // checked (https, public host) before each fetch
  const xml = feed ? await getCappedText(feed, fetchImpl) : null;
  return xml ? latestEpisodes(xml) : [];
}

async function openLibraryBook(links: unknown, fetchImpl: typeof fetch): Promise<RecExtras["book"] | null> {
  const key = /^https:\/\/openlibrary\.org(\/works\/OL\d+W)$/.exec(String((links as Record<string, unknown> | null)?.openlibrary ?? ""))?.[1];
  if (!key) return null;
  const work = await getJson(`https://openlibrary.org${key}.json`, HEADERS, fetchImpl);
  const search = await getJson(`https://openlibrary.org/search.json?q=${encodeURIComponent(`key:${key}`)}&fields=number_of_pages_median,first_publish_year&limit=1`, HEADERS, fetchImpl);
  return bookFromOpenLibrary(work, search);
}

async function wikipedia(aboutUrl: string | null, fetchImpl: typeof fetch): Promise<RecExtras["wiki"] | null> {
  const title = aboutUrl?.startsWith(WIKI) ? aboutUrl.slice(WIKI.length) : null; // already in URL form ("Sault_(band)")
  if (!title || !/^[^/?#\s]+$/.test(title)) return null;
  const summary = await getJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${title}`, HEADERS, fetchImpl);
  return summary === null ? null : wikiExtract(summary, aboutUrl!);
}

/**
 * One matched tip → its extras ({} when there is nothing). A 429/5xx or a timeout throws, for the lane to handle.
 * Discogs (decision 047) runs last and only when the caller passes a key (never read from process.env here). Its 429 stops
 * the step before anything is saved; its other failures are logged and leave the other extras intact.
 */
export async function fetchExtras(rec: ExtrasRec, fetchImpl: typeof fetch = fetch, discogs: DiscogsAccess | null = null): Promise<RecExtras> {
  const out: RecExtras = {};
  if (rec.type === "song" || rec.type === "album") {
    const preview = await itunesPreview(rec, rec.type, fetchImpl);
    if (preview) out.preview = preview;
  } else if (rec.type === "podcast") {
    const episodes = await podcastEpisodes(rec, fetchImpl);
    if (episodes.length) out.episodes = episodes;
  } else if (rec.type === "video") {
    const id = youtubeId(youtubeVideoUrl(rec.links));
    if (id) out.videoId = id;
  } else if (rec.type === "book") {
    const book = await openLibraryBook(rec.links, fetchImpl);
    if (book) out.book = book;
  }
  const wiki = await wikipedia(rec.about_url, fetchImpl);
  if (wiki) out.wiki = wiki;
  if (rec.type === "album" || rec.type === "song" || rec.type === "artist") {
    if (!discogs) logDiscogsSkippedOnce();
    else {
      const found = await fetchDiscogsSoft(rec, discogs, fetchImpl);
      if (found) out.discogs = found;
    }
  }
  return out;
}
