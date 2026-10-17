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

// Per-process spacing only. BINDING for callers (decision 012): call MusicBrainz only from the cron sweep, one rec at a
// time, under a Postgres advisory lock, stopping the sweep on the first 503; never from the webhook.
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

// Lucene query syntax: escape every special character so a title like "Help!" or "AC/DC" stays a plain term, and
// lowercase the operator words (only uppercase AND/OR/NOT are operators) so "AND ALSO THE TREES" stays a title.
const escapeLucene = (s: string) =>
  s.replace(/[+\-!(){}[\]^"~*?:\\/]|&&|\|\|/g, (m) => m.split("").map((ch) => `\\${ch}`).join(""))
    .replace(/\b(AND|OR|NOT)\b/g, (w) => w.toLowerCase());

// Fuzzy (~, edit distance ≤2) only on plain words of 4+ letters: "Salt~" finds the misheard "SAULT"; short words would match anything.
const fuzzy = (s: string) => s.split(/\s+/).filter(Boolean).map((w) => (/^[\p{L}\p{N}]{4,}$/u.test(w) ? `${w}~` : escapeLucene(w))).join(" ");

// All clauses are optional (MusicBrainz ranks by score): exact title phrase (boosted) > title words > artist, fuzzily.
// A required artist clause would drop the right album when Bee mishears the artist (rec 157: "Salt" for SAULT).
export function mbQuery(q: EnrichQuery): string {
  if (!isMusic(q.type)) throw new Error(`musicbrainz: ${q.type} is not a music type`);
  const { field } = ENTITY[q.type];
  if (q.type === "artist") return `artist:"${escapeLucene(q.name)}"^2 artist:(${fuzzy(q.name)})`;
  const title = `${field}:"${escapeLucene(q.name)}"^2 ${field}:(${escapeLucene(q.name)})`;
  return q.creator?.trim() ? `${title} artist:(${fuzzy(q.creator)})` : title;
}

type Credit = { name?: string; joinphrase?: string };
const creditOf = (ac: Credit[] | undefined) => (ac?.length ? ac.map((c) => `${c.name ?? ""}${c.joinphrase ?? ""}`).join("").trim() || null : null);
const yearOf = (d: string | undefined) => (d && /^\d{4}/.test(d) ? d.slice(0, 4) : null);
const joinDetail = (parts: (string | undefined | null)[]) => parts.filter(Boolean).join(", ") || null;

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped external JSON, read defensively */
// The song's own release: earliest-dated, no secondary types (not a compilation, DJ mix, live…), not "Various Artists".
// A song's first listed release is often a compilation with someone else's cover; art and "from <album>" come from this.
const VARIOUS_ARTISTS = "89ad4ac3-39f7-470e-963a-56509c546377"; // MusicBrainz special-purpose artist
const isVarious = (r: any) => (r["artist-credit"] ?? []).some((c: any) => c?.artist?.id === VARIOUS_ARTISTS || c?.name === "Various Artists");
function originalRelease(releases: any[] | undefined): any | undefined {
  return (releases ?? [])
    .filter((r) => r?.["release-group"]?.id && !r["release-group"]["secondary-types"]?.length && !isVarious(r))
    .sort((a, b) => String(a.date || "9999").localeCompare(String(b.date || "9999")))[0];
}

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
  const original = originalRelease(d.releases);
  const release = original ?? d.releases?.[0];
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
