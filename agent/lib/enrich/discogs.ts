import type { RecType } from "../types";
import { norm } from "./apple-music";
import { getJson, USER_AGENT } from "./types";

// Discogs add-on (decision 047): label, catalog number, year, formats, genres/styles and credits for a matched
// album / song / artist, stored once on recommendations.extras.discogs (+ links.discogs). Consumer key/secret in the
// Authorization header (60 requests/min); no OAuth, because Earmark never acts on a Discogs account.
// API terms (https://support.discogs.com/hc/en-us/articles/360009334593-API-Terms-of-Use): the fields we keep are CC0
// data (titles, dates, formats, credits, labels, artist names); Discogs IMAGES are restricted, so cover_image is never
// read or stored. Wherever the data shows, it carries "Data provided by Discogs." linking to links.discogs, no nofollow.
const API = "https://api.discogs.com";
const SITE = "https://www.discogs.com";
export const DISCOGS_GAP_MS = 1_100; // 60/min means >= 1 s between calls; keep a margin
export const MAX_CREDITS = 12;
const MAX_LABELS = 3;
const MAX_TAGS = 8;
const MAX_SONG_CANDIDATES = 2; // releases fetched to find the track; each is one call

export interface DiscogsAccess { key: string; secret: string }
export interface DiscogsExtras {
  url: string;
  labels: { name: string; catno: string | null }[];
  year: number | null;
  formats: string[];
  genres: string[];
  styles: string[];
  credits: { name: string; role: string }[];
  fetchedAt: string; // ISO; the terms call the data "dynamic", so we know how old it is
}
export interface DiscogsRec { type: RecType; canonical_name: string; creator: string | null }

/** Null when DISCOGS_KEY/DISCOGS_SECRET are absent: callers skip Discogs (one log line), never error. */
export function discogsAccess(source: Record<string, string | undefined> = process.env): DiscogsAccess | null {
  const key = source.DISCOGS_KEY?.trim();
  const secret = source.DISCOGS_SECRET?.trim();
  return key && secret ? { key, secret } : null;
}

// ponytail: per-instance gap only, like nominatim.ts. Fine under the rec-lane lease and a one-at-a-time script.
// Upgrade: a DB-held "last call" timestamp if two processes ever run together.
let lastCallAt = 0;
async function discogsSlot(): Promise<void> {
  const at = Math.max(Date.now(), lastCallAt + DISCOGS_GAP_MS);
  lastCallAt = at;
  const wait = at - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}
/** Test-only. */
export function resetDiscogsThrottle(): void {
  lastCallAt = 0;
}

let skipLogged = false;
export function logDiscogsSkippedOnce(): void {
  if (skipLogged) return;
  skipLogged = true;
  console.log("skipped: discogs not configured");
}
/** Test-only. */
export function resetDiscogsSkipLog(): void {
  skipLogged = false;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped external JSON, read defensively */
const isId = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const noNumber = (name: string) => name.replace(/\s*\(\d+\)$/, ""); // Discogs tells same-named artists apart: "Sault (2)"
const strings = (v: unknown, max: number): string[] =>
  [...new Set(Array.isArray(v) ? v.flatMap((s) => (str(s) ? [str(s)!] : [])) : [])].slice(0, max);

/**
 * A database/search answer → the ids worth fetching, best first. Conservative: the title ("Artist - Title") must equal
 * ours once normalised (artist qualifiers like "(2)" dropped). An artist needs exactly one exact name (two same-named
 * artists is a guess, so none). A song keeps releases by the right artist; the tracklist is checked after the fetch. Pure.
 */
export function pickCandidates(json: unknown, rec: DiscogsRec): number[] {
  const results: any[] = Array.isArray((json as any)?.results) ? (json as any).results : [];
  const rows = results.flatMap((r) => (isId(r?.id) && str(r.title) ? [{ id: r.id as number, title: rec.type === "artist" ? noNumber(r.title) : r.title.replace(/\s\(\d+\)(?= - )/, "") }] : []));
  const name = norm(rec.canonical_name);
  if (!name) return [];
  if (rec.type === "artist") {
    const hits = [...new Map(rows.filter((r) => norm(r.title) === name).map((r) => [r.id, r.id])).values()];
    return hits.length === 1 ? hits : [];
  }
  const creator = norm(rec.creator);
  if (!creator) return [];
  if (rec.type === "album") return rows.filter((r) => norm(r.title) === `${creator} ${name}`).slice(0, 1).map((r) => r.id);
  return rows.filter((r) => norm(r.title).startsWith(`${creator} `)).slice(0, MAX_SONG_CANDIDATES).map((r) => r.id);
}

/** Does this release's tracklist hold the song? "Movement 1" fits "Movement 1 (feat. …)", nothing looser. Pure. */
export function hasTrack(release: unknown, song: string): boolean {
  const want = norm(song);
  const tracks: any[] = Array.isArray((release as any)?.tracklist) ? (release as any).tracklist : [];
  return !!want && tracks.some((t) => {
    const have = norm(typeof t?.title === "string" ? t.title : "");
    return have === want || have.startsWith(`${want} `);
  });
}

/** A /releases/{id} answer → what the page shows. Credits are public artist credits, full names. Pure. */
export function parseRelease(json: unknown, now: Date = new Date()): DiscogsExtras | null {
  const r = json as any;
  if (!isId(r?.id)) return null;
  const labels = [...new Map((Array.isArray(r.labels) ? r.labels : []).flatMap((l: any) => {
    const name = str(l?.name);
    const catno = str(l?.catno);
    return name ? [[`${name}|${catno}`, { name: noNumber(name), catno: catno && catno.toLowerCase() !== "none" ? catno : null }]] : [];
  })).values()] as DiscogsExtras["labels"];
  const formats = strings((Array.isArray(r.formats) ? r.formats : []).flatMap((f: any) => [f?.name, ...(Array.isArray(f?.descriptions) ? f.descriptions : [])]), 4);
  const credits = [...new Map((Array.isArray(r.extraartists) ? r.extraartists : []).flatMap((c: any) => {
    const name = str(c?.name);
    const role = str(c?.role);
    return name && role ? [[`${name}|${role}`, { name: noNumber(name), role }]] : [];
  })).values()].slice(0, MAX_CREDITS) as DiscogsExtras["credits"];
  return {
    url: `${SITE}/release/${r.id}`,
    labels: labels.slice(0, MAX_LABELS),
    year: Number.isInteger(r.year) && r.year > 0 ? r.year : null,
    formats,
    genres: strings(r.genres, MAX_TAGS),
    styles: strings(r.styles, MAX_TAGS),
    credits,
    fetchedAt: now.toISOString(),
  };
}

const EMPTY: Omit<DiscogsExtras, "url" | "fetchedAt"> = { labels: [], year: null, formats: [], genres: [], styles: [], credits: [] };
const DISCOGS_URL = /^https:\/\/www\.discogs\.com\/(release|artist)\/\d+$/;

/** The stored jsonb, as far as the page may trust it: our own discogs.com URL, every part the right shape. Pure. */
export function readDiscogs(raw: unknown): DiscogsExtras | null {
  const x = raw as any;
  if (!x || typeof x !== "object" || typeof x.url !== "string" || !DISCOGS_URL.test(x.url)) return null;
  const labels = (Array.isArray(x.labels) ? x.labels : []).flatMap((l: any) => (str(l?.name) ? [{ name: str(l.name)!, catno: str(l.catno) }] : [])).slice(0, MAX_LABELS);
  const credits = (Array.isArray(x.credits) ? x.credits : []).flatMap((c: any) => (str(c?.name) && str(c?.role) ? [{ name: str(c.name)!, role: str(c.role)! }] : [])).slice(0, MAX_CREDITS);
  return {
    url: x.url, labels, credits,
    year: Number.isInteger(x.year) && x.year > 0 ? x.year : null,
    formats: strings(x.formats, 4), genres: strings(x.genres, MAX_TAGS), styles: strings(x.styles, MAX_TAGS),
    fetchedAt: typeof x.fetchedAt === "string" ? x.fetchedAt : "",
  };
}

/** What the tip page's "Credits & label" section prints; null when Discogs gave nothing beyond the link. Pure. */
export function discogsFacts(d: DiscogsExtras): { rows: [string, string][]; tags: string[]; credits: DiscogsExtras["credits"] } | null {
  const label = d.labels.map((l) => (l.catno ? `${l.name} (${l.catno})` : l.name)).join(", ");
  const rows = ([["Label", label], ["Year", d.year ? String(d.year) : ""], ["Format", d.formats.join(", ")]] as [string, string][]).filter(([, v]) => v);
  const tags = [...new Set([...d.genres, ...d.styles])];
  return rows.length || tags.length || d.credits.length ? { rows, tags, credits: d.credits } : null;
}

async function call(path: string, access: DiscogsAccess, fetchImpl: typeof fetch): Promise<unknown | null> {
  await discogsSlot();
  const headers = { "User-Agent": USER_AGENT, Accept: "application/json", Authorization: `Discogs key=${access.key}, secret=${access.secret}` };
  return getJson(`${API}${path}`, { headers }, fetchImpl); // a non-2xx throws ProviderHttpError (429 = back off, others = a try)
}

function searchPath(rec: DiscogsRec): string {
  const p = new URLSearchParams({ per_page: "5" });
  if (rec.type === "artist") {
    p.set("type", "artist");
    p.set("q", rec.canonical_name);
  } else if (rec.type === "album") {
    p.set("type", "master");
    p.set("release_title", rec.canonical_name);
    p.set("artist", rec.creator ?? "");
  } else {
    p.set("type", "release");
    p.set("track", rec.canonical_name);
    p.set("artist", rec.creator ?? "");
  }
  return `/database/search?${p}`;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * One matched album / song / artist → its Discogs data, or null when nothing matches confidently (then nothing is stored).
 * Albums: search masters → the master's main release. Songs: search releases containing the track → the first whose
 * tracklist really has it. Artists: the profile link only. 2 to 4 calls, each >= 1.1 s apart. Throws on HTTP errors.
 * ponytail: an album with no master falls through to null; a second search with type=release is the upgrade.
 */
export async function fetchDiscogs(rec: DiscogsRec, access: DiscogsAccess, fetchImpl: typeof fetch = fetch): Promise<DiscogsExtras | null> {
  if (rec.type !== "album" && rec.type !== "song" && rec.type !== "artist") return null;
  const ids = pickCandidates(await call(searchPath(rec), access, fetchImpl), rec);
  if (ids.length === 0) return null;
  if (rec.type === "artist") return { url: `${SITE}/artist/${ids[0]}`, ...EMPTY, fetchedAt: new Date().toISOString() };
  for (const id of ids) {
    let releaseId = id;
    if (rec.type === "album") {
      const mainRelease = ((await call(`/masters/${id}`, access, fetchImpl)) as { main_release?: unknown } | null)?.main_release;
      if (!isId(mainRelease)) continue;
      releaseId = mainRelease;
    }
    const release = await call(`/releases/${releaseId}`, access, fetchImpl);
    if (release === null || (rec.type === "song" && !hasTrack(release, rec.canonical_name))) continue;
    const parsed = parseRelease(release);
    if (parsed) return parsed;
  }
  return null;
}
