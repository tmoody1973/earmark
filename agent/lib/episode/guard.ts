import type { EpisodeData } from "./data";

// Deterministic post-check on generated text (script AND title) before anything is voiced or uploaded.
// Reasons are codes only: the offending text is never returned or logged.
export type Reason = "owner" | "excerpt" | "surname" | "unknown_name";

export class ScriptRejectedError extends Error {
  override name = "ScriptRejectedError";
  constructor(readonly reasons: Reason[]) {
    super(`script rejected: ${reasons.join(",")}`);
  }
}

const MAX_EXCERPT_WORDS = 25;
const SPEAKS = "recommended|suggested|said|says|told|mentioned|thinks|loved|swears";
// Capitalised words that start "<X> said" sentences but are not people. No personal names here: the owner comes from env.
const NOT_NAMES = new Set(["you", "he", "she", "they", "it", "we", "i", "someone", "everyone", "nobody", "anyone", "somebody", "this", "that", "who", "one"]);
const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordsIn = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

// One surname: Smith, O'Brien, Müller, Smith-Jones, optionally after particles (de la Cruz, van der Berg).
const SURNAME = "(?:(?:de|la|del|van|von|der|di|da|du|le|bin|al)\\s+)*\\p{Lu}(?:['\u2019]\\p{Lu})?\\p{Ll}+(?:-\\p{Lu}\\p{Ll}+)*";
// Quotation spans. Straight single quotes are skipped on purpose: they cannot be told from apostrophes without false alarms.
const QUOTES = ['"([^"]*)"', "\\u201c([^\\u201d]*)\\u201d", "\\u2018([\\s\\S]*?)\\u2019(?![\\p{L}])", "\\u00ab([^\\u00bb]*)\\u00bb"].map((r) => new RegExp(r, "gu")); // built from strings: TS target rejects \p{} literals

export const recommenderNames = (data: EpisodeData): string[] => {
  const names = new Set<string>();
  for (const rows of Object.values(data)) {
    for (const r of rows as { first_name?: unknown }[]) if (typeof r?.first_name === "string" && r.first_name.trim()) names.add(r.first_name.trim());
  }
  return [...names];
};

// Catalog text only (titles and names of ideas, items and creators). Never excerpts, timelines or other transcript-derived fields.
export const catalogStrings = (data: EpisodeData): string[] => {
  const out: string[] = [];
  for (const rows of Object.values(data)) {
    for (const r of rows as Record<string, unknown>[]) {
      for (const k of ["canonical_name", "creator", "title"]) if (typeof r?.[k] === "string") out.push(r[k] as string);
    }
  }
  return out;
};

export const namesPerson = (text: string, name: string | undefined): boolean =>
  !!name && new RegExp(`(?<![\\p{L}\\p{N}])${esc(name)}(?![\\p{L}\\p{N}])`, "iu").test(text);

export function checkText(text: string, data: EpisodeData, owner: string | undefined): Reason[] {
  const reasons = new Set<Reason>();
  if (namesPerson(text, owner)) reasons.add("owner");

  for (const re of QUOTES) {
    for (const m of text.matchAll(re)) if (wordsIn(m[1] ?? "") > MAX_EXCERPT_WORDS) reasons.add("excerpt");
  }

  const names = recommenderNames(data);
  const known = new Set(names);
  const catalog = catalogStrings(data);
  const inCatalog = (phrase: string) => catalog.some((c) => c.includes(phrase));
  for (const n of names) {
    for (const m of text.matchAll(new RegExp(`(?<![\\p{L}])${esc(n)}\\s+(${SURNAME})`, "gu"))) {
      if (!inCatalog(m[0])) reasons.add("surname"); // "Ann Arbor" is fine only when a catalog title says so
    }
  }
  for (const m of text.matchAll(new RegExp(`(?<![\\p{L}])(\\p{Lu}\\p{Ll}+)\\s+(?:${SPEAKS})\\b`, "gu"))) {
    const w = m[1];
    if (!known.has(w) && !NOT_NAMES.has(w.toLowerCase()) && w.toLowerCase() !== owner?.toLowerCase()) reasons.add("unknown_name");
  }
  // "recommended by Marcus Webb", "from Marcus Webb": a full name whose first name is not on the week's list.
  for (const m of text.matchAll(new RegExp(`(?:(?:${SPEAKS})\\s+by|from)\\s+(\\p{Lu}\\p{Ll}+)\\s+(${SURNAME})`, "gu"))) {
    const phrase = `${m[1]} ${m[2]}`;
    if (!known.has(m[1]) && !inCatalog(phrase)) reasons.add("unknown_name");
  }
  return [...reasons];
}
