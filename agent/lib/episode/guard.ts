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
// Capitalised words that start "<X> said" sentences but are not people.
const NOT_NAMES = new Set(["you", "he", "she", "they", "it", "we", "i", "someone", "everyone", "nobody", "anyone", "somebody", "this", "that", "who", "one", "tarik"]);
const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordsIn = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

export const recommenderNames = (data: EpisodeData): string[] => {
  const names = new Set<string>();
  for (const rows of Object.values(data)) {
    for (const r of rows as { first_name?: unknown }[]) if (typeof r?.first_name === "string" && r.first_name.trim()) names.add(r.first_name.trim());
  }
  return [...names];
};

export const namesPerson = (text: string, name: string | undefined): boolean =>
  !!name && new RegExp(`(?<![\\p{L}\\p{N}])${esc(name)}(?![\\p{L}\\p{N}])`, "iu").test(text);

export function checkText(text: string, data: EpisodeData, owner: string | undefined): Reason[] {
  const reasons = new Set<Reason>();
  if (namesPerson(text, owner)) reasons.add("owner");

  for (const m of text.matchAll(/"([^"]*)"|“([^”]*)”/g)) {
    if (wordsIn(m[1] ?? m[2] ?? "") > MAX_EXCERPT_WORDS) reasons.add("excerpt");
  }

  const names = recommenderNames(data);
  const known = new Set(names.map((n) => n.toLowerCase()));
  const dataText = JSON.stringify(data);
  for (const n of names) {
    for (const m of text.matchAll(new RegExp(`(?<![\\p{L}])${esc(n)}\\s+([A-Z][a-z]+)`, "gu"))) {
      if (!dataText.includes(m[0])) reasons.add("surname"); // "Ann Arbor" is fine when the data says so
    }
  }
  for (const m of text.matchAll(new RegExp(`(?<![\\p{L}])([A-Z][a-z]+)\\s+(?:${SPEAKS})\\b`, "gu"))) {
    const w = m[1].toLowerCase();
    if (!known.has(w) && !NOT_NAMES.has(w) && w !== owner?.toLowerCase() && !dataText.includes(m[1])) reasons.add("unknown_name");
  }
  return [...reasons];
}
