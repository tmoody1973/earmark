import { getJson, MAX_CANDIDATES, USER_AGENT, type Candidate, type EnrichQuery, type ProviderDef } from "./types";

// MusicBrainz web service v2 search, keyless. Docs: https://musicbrainz.org/doc/MusicBrainz_API/Search
// JSON needs fmt=json; a descriptive User-Agent is required; ≤1 request/second per IP, else 503:
// https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting
const MB_BASE = "https://musicbrainz.org/ws/2";
const MB_GAP_MS = 1_000;

const ENTITY = {
  album: { path: "release-group", field: "releasegroup", list: "release-groups" },
  song: { path: "recording", field: "recording", list: "recordings" },
  artist: { path: "artist", field: "artist", list: "artists" },
} as const;
type MusicType = keyof typeof ENTITY;
const isMusic = (t: string): t is MusicType => t in ENTITY;

// ponytail: per-process spacing; parallel serverless instances can still exceed 1 req/s from one egress IP.
// Upgrade path if 503s show up in logs: a shared slot in Postgres (one row, next_at timestamptz).
let nextAt = 0;
async function mbSlot(): Promise<void> {
  const now = Date.now();
  const at = Math.max(now, nextAt);
  nextAt = at + MB_GAP_MS;
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}
/** Test-only: forget the last request time. */
export function resetMusicBrainzThrottle(): void {
  nextAt = 0;
}

// Lucene query syntax: escape every special character so a title like "Help!" or "AC/DC" stays a plain term.
const escapeLucene = (s: string) => s.replace(/[+\-!(){}[\]^"~*?:\\/]|&&|\|\|/g, (m) => m.split("").map((ch) => `\\${ch}`).join(""));

// Fuzzy (~, edit distance ≤2) only on plain words of 4+ letters: "Salt~" finds the misheard "SAULT"; short words would match anything.
const fuzzy = (s: string) => s.split(/\s+/).filter(Boolean).map((w) => (/^[\p{L}\p{N}]{4,}$/u.test(w) ? `${w}~` : escapeLucene(w))).join(" ");

// All clauses are optional (MusicBrainz ranks by score): exact title phrase (boosted) > title words > artist, fuzzily.
// A required artist clause would drop the right album when Bee mishears the artist (rec 157: "Salt" for SAULT).
export function mbQuery(q: EnrichQuery): string {
  if (!isMusic(q.type)) throw new Error(`musicbrainz: ${q.type} is not a music type`);
  const { field } = ENTITY[q.type];
  if (q.type === "artist") return `artist:"${escapeLucene(q.name)}"^2 artist:(${fuzzy(q.name)})`;
  const title = `${field}:"${escapeLucene(q.name)}"^2 ${field}:(${escapeLucene(q.name)})`;
  return q.creator ? `${title} artist:(${fuzzy(q.creator)})` : title;
}

type Credit = { name?: string; joinphrase?: string };
const creditOf = (ac: Credit[] | undefined) => (ac?.length ? ac.map((c) => `${c.name ?? ""}${c.joinphrase ?? ""}`).join("").trim() || null : null);
const yearOf = (d: string | undefined) => (d && /^\d{4}/.test(d) ? d.slice(0, 4) : null);
const joinDetail = (parts: (string | undefined | null)[]) => parts.filter(Boolean).join(", ") || null;

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped external JSON, read defensively */
function toCandidate(type: MusicType, d: any): Candidate {
  const link = { musicbrainz: `https://musicbrainz.org/${ENTITY[type].path}/${d.id}` };
  if (type === "artist") {
    return { canonicalName: d.name, creator: null, yearOrAddress: null, detail: joinDetail([d.disambiguation, d.area?.name]),
      imageUrl: null, links: link, mbid: d.id };
  }
  const base = { canonicalName: d.title, creator: creditOf(d["artist-credit"]), yearOrAddress: yearOf(d["first-release-date"]),
    imageUrl: null, links: link, mbid: d.id };
  if (type === "album") {
    return { ...base, detail: joinDetail([d["primary-type"], ...(d["secondary-types"] ?? [])]), releaseGroupId: d.id };
  }
  const release = d.releases?.[0];
  // Art from an original release only: a song's first release is often a compilation or DJ mix with someone else's cover.
  const original = d.releases?.find((r: any) => r?.["release-group"]?.id && !r["release-group"]["secondary-types"]?.length);
  return { ...base, detail: joinDetail([d.disambiguation, release?.title && `from ${release.title}`]),
    releaseGroupId: original?.["release-group"]?.id };
}

export const musicBrainzProvider: ProviderDef = {
  async build(q) {
    const query = mbQuery(q); // throws for non-music types before taking a rate-limit slot
    await mbSlot();
    const url = `${MB_BASE}/${ENTITY[q.type as MusicType].path}?fmt=json&limit=${MAX_CANDIDATES}&query=${encodeURIComponent(query)}`;
    return { url, init: { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } } };
  },
  parse(json, q) {
    if (!isMusic(q.type)) return [];
    const list: any[] = (json as any)?.[ENTITY[q.type].list] ?? [];
    return list.filter((d) => d?.id && (d.title || d.name)).map((d) => toCandidate(q.type as MusicType, d));
  },
};

// Cover Art Archive, keyless: GET /release-group/{mbid} lists images; 404 = no art chosen.
// Docs: https://musicbrainz.org/doc/Cover_Art_Archive/API
export function coverArtFromJson(json: unknown): string | null {
  const images: any[] = (json as any)?.images ?? [];
  const front = images.find((i) => i?.front);
  const url: unknown = front?.thumbnails?.["500"] ?? front?.thumbnails?.large ?? front?.image;
  return typeof url === "string" && url ? url.replace(/^http:\/\//, "https://") : null;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function coverArtUrl(releaseGroupId: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const json = await getJson(`https://coverartarchive.org/release-group/${releaseGroupId}`,
    { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } }, fetchImpl);
  return json === null ? null : coverArtFromJson(json);
}
