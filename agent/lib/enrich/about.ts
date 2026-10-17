// The "about" note (M3-T4b, decision 017): one plain sentence from Wikipedia on the tip's subject (the artist, the
// author, the place, the show), stored with its source URL. "What" text, kept apart from the why (M3-T5). Keyless.
// Two requests per tip (three for music), all through getJson (8 s timeout, one try, 404 = nothing):
//  1. MediaWiki REST page search, as wikipediaProvider uses: GET /w/rest.php/v1/search/page?q=&limit= → pages[].{key,
//     title,description,excerpt}. https://www.mediawiki.org/wiki/API:REST_API/Reference#Search_pages
//     Titles are case-sensitive (summary/SAULT is a 404), so search first; a kind hint ("SAULT music") brings the
//     band's page up past the disambiguation page and the cities.
//  2. Wikimedia REST page summary: GET /api/rest_v1/page/summary/{title} → { type: "standard" | "disambiguation" | …,
//     titles.canonical, description, extract, wikibase_item, content_urls.desktop.page }.
//     https://en.wikipedia.org/api/rest_v1/#/Page%20content
//  3. Music only, Wikidata Query Service: GET https://query.wikidata.org/sparql?format=json&query=ASK {…} → { boolean }.
//     https://www.wikidata.org/wiki/Wikidata:SPARQL_query_service · P434 MusicBrainz artist ID
//     (https://www.wikidata.org/wiki/Property:P434), P436 release group ID, P4404 recording ID, P175 performer.
// Never a wrong person's bio. All must hold, else no note: the title (minus a "(band)" qualifier) is the subject's name;
// the description fits the kind of thing (whole words); exactly one search result qualifies; the summary is a standard
// page with that title; and the page is this tip's subject, not a namesake (confirmsSubject; for music, Wikidata ties
// the page's item to the MusicBrainz entity the tip was matched to).
import { clampWhy } from "../garden/cards";
import type { RecType } from "../types";
import { getJson, MAX_CANDIDATES, USER_AGENT } from "./types";

export const ABOUT_MAX_WORDS = 25;
export interface About { text: string; url: string }
export interface AboutRec {
  type: RecType; canonical_name: string; creator: string | null; year_or_address: string | null; links: unknown;
}

// Whole words only, so "martial artist", "film producer", "musical film" or "talk show host" don't pass as music/screen.
const MUSIC = /\b(?:bands?|groups?|musicians?|singers?|rappers?|songwriters?|composers?|producers?|djs?|duos?|trios?|collectives?|ensembles?|orchestras?|music|artists?|guitarists?|pianists?|drummers?|bassists?|vocalists?|choirs?)\b/i;
const NOT_MUSIC = /\b(?:martial|visual|graphic|tattoo|make-?up|street|performance|digital|comics?|special effects|voice|con)\s+artists?\b|\b(?:film|movie|television|tv|theatre|theater|stage)\s+producers?\b/gi;
const WRITER = /\b(?:writers?|authors?|novelists?|poets?|journalists?|essayists?|historians?|playwrights?|columnists?|biographers?|scholars?|philosophers?|critics?|memoirists?|illustrators?|cartoonists?|economists?|\w*scientists?|professors?|academics?|psychologists?|editors?|theologians?)\b/i;
const SCREEN = /\b(?:films?|movies?|television|tv|series|sitcoms?|miniseries|documentar(?:y|ies)|anime|shows?|drama|comedy)\b/i;
const PERSON = /\bborn\b|\b(?:singers?|actors?|actresses?|politicians?|players?|writers?|musicians?|rappers?|presenters?|hosts?|comedians?|journalists?|directors?|producers?|businessman|businesswoman|athletes?)\b/i;
const LIFESPAN = /\(\d{3,4}\s*[–-]\s*\d{2,4}\)/;
const VENUE = /\b(?:restaurants?|bars?|caf[eé]s?|coffeehouses?|coffee shops?|brewer(?:y|ies)|venues?|museums?|shops?|stores?|baker(?:y|ies)|hotels?|parks?|theatres?|theaters?|galler(?:y|ies)|clubs?|nightclubs?|diners?|pubs?|taverns?|markets?|bookstores?|bookshops?|winer(?:y|ies)|distiller(?:y|ies)|pizzerias?|eater(?:y|ies))\b/i;
const DISAMBIGUATION = /^topics referred to by the same term$/i;
const COUNTRY = /^(?:usa|us|u\.s\.a?\.?|united states|uk|united kingdom|canada)$/i;

// Whose page, the search hint, and what its one-line Wikipedia description must look like.
const KINDS: Partial<Record<RecType, { subject: "creator" | "name"; hint: string; fits: (d: string) => boolean }>> = {
  album: { subject: "creator", hint: "music", fits: (d) => MUSIC.test(d.replace(NOT_MUSIC, "")) },
  song: { subject: "creator", hint: "music", fits: (d) => MUSIC.test(d.replace(NOT_MUSIC, "")) },
  artist: { subject: "name", hint: "music", fits: (d) => MUSIC.test(d.replace(NOT_MUSIC, "")) },
  book: { subject: "creator", hint: "writer", fits: (d) => WRITER.test(d) },
  place: { subject: "name", hint: "", fits: (d) => !PERSON.test(d) && !LIFESPAN.test(d) },
  podcast: { subject: "name", hint: "podcast", fits: (d) => /\bpodcasts?\b/i.test(d) && !PERSON.test(d) },
  film_tv: { subject: "name", hint: "", fits: (d) => SCREEN.test(d) && !PERSON.test(d) },
  // video: none on purpose (add-on). A channel is rarely on Wikipedia and a namesake is easy to hit: store nothing.
};
const isMusic = (t: RecType) => t === "album" || t === "song" || t === "artist";

export function aboutSubject(rec: AboutRec): string | null {
  const kind = KINDS[rec.type];
  const subject = (kind?.subject === "creator" ? rec.creator : kind ? rec.canonical_name : null)?.trim();
  return subject || null;
}

// Plain words for comparing names: case, accents and punctuation don't count.
const words = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "").replace(/<[^>]*>/g, " ").replace(/&/g, " and ")
  .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
// "Sault (band)" and "SAULT" are the same name; "Sault Ste. Marie" is not.
const sameName = (s: string) => words(s.replace(/\s*\([^()]*\)\s*$/, ""));
const mentions = (haystack: string, needle: string) => !!words(needle) && ` ${words(haystack)} `.includes(` ${words(needle)} `);

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped external JSON, read defensively */
/** The search page key of the one page that is clearly the subject, or null. Pure. */
export function pickAboutPage(json: unknown, subject: string, type: RecType): string | null {
  const kind = KINDS[type];
  const pages: unknown = (json as any)?.pages;
  if (!kind || !Array.isArray(pages)) return null;
  const fits = pages.filter((p: any) => typeof p?.key === "string" && typeof p.title === "string"
    && typeof p.description === "string" && !DISAMBIGUATION.test(p.description) && kind.fits(p.description)
    && sameName(p.title) === sameName(subject));
  return fits.length === 1 ? (fits[0] as any).key : null;
}

/** The summary's first plain sentence and its page URL, only for a standard page with the picked title. Pure. */
export function aboutFromSummary(json: unknown, key: string): About | null {
  const s = json as any;
  if (s?.type !== "standard" || s.titles?.canonical !== key || typeof s.extract !== "string") return null;
  const url = s.content_urls?.desktop?.page;
  if (typeof url !== "string" || !url.startsWith("https://en.wikipedia.org/wiki/")) return null;
  const text = cleanAbout(s.extract);
  return text ? { text, url } : null;
}

/**
 * Is this page about this tip, not a namesake? Pure. A place: a venue word in its description, or the tip's own town
 * in the summary. A book: the author's page names the book. Film/TV and podcasts: the year or the maker matches, and
 * nothing when we know neither. Music is checked on Wikidata instead (fetchAbout).
 */
export function confirmsSubject(rec: AboutRec, page: { description: string; extract: string; excerpt: string }): boolean {
  const said = `${page.description} ${page.extract}`;
  switch (rec.type) {
    case "place": {
      if (VENUE.test(page.description)) return true;
      const towns = (rec.year_or_address ?? "").split(",").map((p) => p.trim())
        .filter((p) => p.length >= 3 && !/\d/.test(p) && !COUNTRY.test(p) && sameName(p) !== sameName(rec.canonical_name));
      return towns.some((t) => mentions(page.extract, t));
    }
    case "book":
      return mentions(`${page.extract} ${page.excerpt}`, rec.canonical_name.split(/[:(]/)[0]!);
    case "film_tv":
    case "podcast": {
      const year = /\b(1[89]\d\d|20\d\d)\b/.exec(rec.year_or_address ?? "")?.[1];
      const maker = rec.creator?.trim();
      return (!!year && mentions(said, year)) || (!!maker && mentions(said, maker));
    }
    default:
      return isMusic(rec.type);
  }
}

const MBID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export type MusicBrainzRef = { kind: "artist" | "release-group" | "recording"; id: string };

/** The MusicBrainz entity the tip was matched to (links.musicbrainz, written by the music provider). Pure. */
export function musicBrainzRef(links: unknown): MusicBrainzRef | null {
  const url = (links as any)?.musicbrainz;
  const m = typeof url === "string" ? new RegExp(`^https://musicbrainz\\.org/(artist|release-group|recording)/(${MBID})$`).exec(url) : null;
  return m ? { kind: m[1] as MusicBrainzRef["kind"], id: m[2]! } : null;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** SPARQL ASK: the page's Wikidata item is that MusicBrainz artist, or the performer of that release group/recording. */
export function wikidataAskQuery(item: string, ref: MusicBrainzRef): string | null {
  if (!/^Q\d+$/.test(item) || !new RegExp(`^${MBID}$`).test(ref.id)) return null; // nothing else reaches the query
  if (ref.kind === "artist") return `ASK { wd:${item} wdt:P434 "${ref.id}" }`;
  return `ASK { ?x wdt:${ref.kind === "release-group" ? "P436" : "P4404"} "${ref.id}" ; wdt:P175 wd:${item} }`;
}

// A period after one of these, an initial ("F.") or a dotted acronym ("U.S.") does not end a sentence... unless it's
// the last thing in the text. ponytail: a fixed list; add an abbreviation when a real note gets cut short.
const NOT_AN_END = /(?:^|[\s(])(?:St|Ste|Mt|Ft|Jr|Sr|Dr|Mr|Mrs|Ms|Prof|Gen|Gov|Sen|Rev|Inc|Co|Ltd|No|vs|[A-Z]|(?:[A-Z]\.)+[A-Z])\.$/;

/** Parentheticals out (pronunciations, birth dates), first sentence only, at most 25 words. Pure. */
export function cleanAbout(extract: string): string | null {
  let text = extract;
  for (let prev = ""; prev !== text; ) [prev, text] = [text, text.replace(/\s*\([^()]*\)/g, "")];
  text = text.replace(/\s+([,.;:])/g, "$1").replace(/\s+/g, " ").trim();
  const ends = text.matchAll(/[.!?](?=\s+["“‘']?[\p{Lu}\p{N}])/gu);
  for (const end of ends) {
    const head = text.slice(0, end.index + 1);
    if (!NOT_AN_END.test(head)) {
      text = head;
      break;
    }
  }
  return clampWhy(text, ABOUT_MAX_WORDS);
}

const HEADERS = { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } };

/** Search, pick, one summary, confirm. null when unsure or not found; a 5xx/429 or timeout throws for the lane. */
export async function fetchAbout(rec: AboutRec, fetchImpl: typeof fetch = fetch): Promise<About | null> {
  const subject = aboutSubject(rec);
  const mb = musicBrainzRef(rec.links);
  if (!subject || (isMusic(rec.type) && !mb)) return null; // music with no MusicBrainz match: nothing to confirm against
  const q = [subject, KINDS[rec.type]!.hint].filter(Boolean).join(" ");
  const search = await getJson(`https://en.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(q)}&limit=${MAX_CANDIDATES}`, HEADERS, fetchImpl);
  const key = search === null ? null : pickAboutPage(search, subject, rec.type);
  if (!key) return null;
  // The key is already a title in URL form ("Sault_(band)"); encode only what a path segment can't hold.
  const summary = await getJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(key).replace(/%28/g, "(").replace(/%29/g, ")")}`, HEADERS, fetchImpl);
  const about = summary === null ? null : aboutFromSummary(summary, key);
  if (!about) return null;
  /* eslint-disable @typescript-eslint/no-explicit-any -- untyped external JSON, read defensively */
  const s = summary as any;
  const hit = ((search as any).pages as any[]).find((p) => p?.key === key);
  const page = { description: String(s.description ?? hit?.description ?? ""), extract: String(s.extract), excerpt: String(hit?.excerpt ?? "") };
  if (!confirmsSubject(rec, page)) return null;
  if (!mb) return about;
  const ask = wikidataAskQuery(String(s.wikibase_item ?? ""), mb);
  if (!ask) return null;
  const answer = await getJson(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(ask)}`,
    { headers: { "User-Agent": USER_AGENT, Accept: "application/sparql-results+json" } }, fetchImpl);
  return (answer as any)?.boolean === true ? about : null;
  /* eslint-enable @typescript-eslint/no-explicit-any */
}
