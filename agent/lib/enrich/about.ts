// The "about" note (M3-T4b, decision 017): one plain sentence from Wikipedia on the tip's subject (the artist, the
// author, the place, the show), stored with its source URL. "What" text, kept apart from the why (M3-T5). Keyless.
// Two requests per tip, both through getJson (8 s timeout, one try, 404 = nothing):
//  1. MediaWiki REST page search, as wikipediaProvider uses: GET /w/rest.php/v1/search/page?q=&limit= → pages[].{key,
//     title,description}. https://www.mediawiki.org/wiki/API:REST_API/Reference#Search_pages
//     Titles are case-sensitive (summary/SAULT is a 404), so search first; a kind hint ("SAULT music") brings the
//     band's page up past the disambiguation page and the cities.
//  2. Wikimedia REST page summary: GET /api/rest_v1/page/summary/{title} → { type: "standard" | "disambiguation" | …,
//     titles.canonical, extract, content_urls.desktop.page }. https://en.wikipedia.org/api/rest_v1/#/Page%20content
// Never a wrong person's bio: the page title (minus a "(band)" qualifier) must be the subject's name, its description
// must fit the kind of thing, exactly one page may qualify, and the summary must be a standard page with that title.
// Unsure at any step → no note.
import { clampWhy } from "../garden/cards";
import type { RecType } from "../types";
import { getJson, MAX_CANDIDATES, USER_AGENT } from "./types";

export const ABOUT_MAX_WORDS = 25;
export interface About { text: string; url: string }
export interface AboutRec { type: RecType; canonical_name: string; creator: string | null }

const MUSIC = /band|group|musician|singer|rapper|songwriter|composer|producer|\bdj\b|duo|trio|collective|ensemble|orchestra|music|artist|guitarist|pianist|drummer|bassist|vocalist|choir/i;
const WRITER = /writer|author|novelist|poet|journalist|essayist|historian|playwright|columnist|biographer|scholar|philosopher|critic|memoirist|illustrator|cartoonist|economist|scientist|professor|academic|psychologist|editor/i;
const PERSON = /\bborn\b|\d{3,4}\s*[–-]\s*\d{2,4}|singer|actor|actress|politician|player|writer|musician|rapper/i;
const DISAMBIGUATION = /^topics referred to by the same term$/i;

// Whose page, the search hint, and what its one-line Wikipedia description must look like.
const KINDS: Partial<Record<RecType, { subject: "creator" | "name"; hint: string; fits: (d: string) => boolean }>> = {
  album: { subject: "creator", hint: "music", fits: (d) => MUSIC.test(d) },
  song: { subject: "creator", hint: "music", fits: (d) => MUSIC.test(d) },
  artist: { subject: "name", hint: "music", fits: (d) => MUSIC.test(d) },
  book: { subject: "creator", hint: "writer", fits: (d) => WRITER.test(d) },
  place: { subject: "name", hint: "", fits: (d) => !PERSON.test(d) },
  podcast: { subject: "name", hint: "podcast", fits: (d) => /podcast/i.test(d) },
  film_tv: { subject: "name", hint: "", fits: (d) => /film|television|series|sitcom|documentary|anime|show/i.test(d) },
};

export function aboutSubject(rec: AboutRec): string | null {
  const kind = KINDS[rec.type];
  const subject = (kind?.subject === "creator" ? rec.creator : kind ? rec.canonical_name : null)?.trim();
  return subject || null;
}

// "Sault (band)" and "SAULT" are the same name; "Sault Ste. Marie" is not. Case and accents don't count.
const sameName = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "").replace(/\s*\([^()]*\)\s*$/, "")
  .replace(/&/g, " and ").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

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
/* eslint-enable @typescript-eslint/no-explicit-any */

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

/** Search, pick, then one summary. null when unsure or not found; a 5xx/429 or timeout throws for the lane. */
export async function fetchAbout(rec: AboutRec, fetchImpl: typeof fetch = fetch): Promise<About | null> {
  const subject = aboutSubject(rec);
  if (!subject) return null;
  const q = [subject, KINDS[rec.type]!.hint].filter(Boolean).join(" ");
  const search = await getJson(`https://en.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(q)}&limit=${MAX_CANDIDATES}`, HEADERS, fetchImpl);
  const key = search === null ? null : pickAboutPage(search, subject, rec.type);
  if (!key) return null;
  // The key is already a title in URL form ("Sault_(band)"); encode only what a path segment can't hold.
  const summary = await getJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(key).replace(/%28/g, "(").replace(/%29/g, ")")}`, HEADERS, fetchImpl);
  return summary === null ? null : aboutFromSummary(summary, key);
}
