import type { AttributionSource } from "../types";

// FR-04 order: voice trigger → second-person cue → Bee summary → (Slack question, M3).
// Bee never labels speakers, so a name is used only if it literally appears in the text it came from.
const CUES = [
  /\byou (?:have|need|ought|got) to (?:try|hear|read|watch|see|check|listen|go|visit)\b/i,
  /\byou(?:['’]d| would|['’]ll| will) (?:love|like|dig|enjoy)\b/i,
  /\byou should (?:try|read|watch|listen|check|go|see|hear|visit)\b/i,
  /\byou gotta\b/i,
  /\byou must (?:try|see|read|hear)\b/i,
  /\bhave you (?:tried|heard|read|seen|been)\b/i,
  /\bcheck (?:it|this|that|them) out\b/i,
];

const NOT_NAMES = new Set(["earmark", "unknown", "bee", "you", "i", "me", "speaker"]);

export function hasSecondPersonCue(text: string): boolean {
  return CUES.some((re) => re.test(text));
}

export function firstNameOnly(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? "";
  const bare = first.replace(/['’]s$/i, "").replace(/[^\p{L}\p{M}'-]/gu, "");
  return bare ? bare[0]!.toUpperCase() + bare.slice(1) : "";
}

// Does the text capitalize names? Ignores speaker labels, the text's first letter, sentence/line starts and
// the pronoun "I". Bee's lowercase transcripts then match names case-insensitively.
// ponytail: in fully lowercase text a name like "Will" also matches the word "will" (accepted risk).
const LABELS = /\b(?:Unknown|Speaker\s*\d*|Bee)\s*:\s*/gi;
function capitalizesNames(text: string): boolean {
  const s = text.replace(LABELS, "").trim();
  return /(?<!^|[.!?]\s+|\n\s*)(?!I(?![\p{L}]))\p{Lu}/u.test(s);
}

// Whole first name, not part of a longer word or hyphenated/apostrophe name ("Ann-Marie"), but a possessive 's is fine.
// A capitalized occurrence is required unless the text has no capitals at all (all-lowercase transcripts).
export function nameAppearsIn(name: string, ...texts: (string | null)[]): boolean {
  const n = firstNameOnly(name);
  if (!n) return false;
  const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?<![\\p{L}\\p{M}-])${escaped}(?=$|['’]s(?![\\p{L}])|[^\\p{L}\\p{M}'’-]|['’-](?![\\p{L}]))`, "giu");
  return texts.some((t) => {
    if (!t) return false;
    const caseSensitive = capitalizesNames(t);
    return [...t.matchAll(re)].some((m) => !caseSensitive || /\p{Lu}/u.test(m[0][0]!));
  });
}

// The one place a name from any source (trigger, window, summary, model) is vetted.
// The garden owner is never a recommender: people address them by name, and a tip can't come from the person it is for.
// ponytail: exact first-name match only; nicknames/aliases are not handled.
export function validNameFor(owner: string | null | undefined, name: string | null, ...texts: (string | null)[]): string | null {
  if (!name) return null;
  const first = firstNameOnly(name);
  if (!first || NOT_NAMES.has(first.toLowerCase())) return null;
  if (owner && first.toLowerCase() === firstNameOnly(owner).toLowerCase()) return null;
  return nameAppearsIn(first, ...texts) ? first : null;
}

export function validName(name: string | null, ...texts: (string | null)[]): string | null {
  return validNameFor(null, name, ...texts);
}

export function chooseRecommender(input: {
  triggerName: string | null;
  windowName: string | null;
  windowText: string;
  summaryName: string | null;
  summaryText: string | null;
  ownerFirstName?: string | null;
}): { firstName: string | null; source: AttributionSource } {
  const valid = (name: string | null, ...texts: (string | null)[]) => validNameFor(input.ownerFirstName, name, ...texts);
  const trigger = valid(input.triggerName, input.windowText);
  if (trigger) return { firstName: trigger, source: "voice_trigger" };
  const fromWindow = hasSecondPersonCue(input.windowText) ? valid(input.windowName, input.windowText) : null;
  if (fromWindow) return { firstName: fromWindow, source: "second_person" };
  const fromSummary = valid(input.summaryName, input.summaryText);
  if (fromSummary) return { firstName: fromSummary, source: "summary" };
  return { firstName: null, source: "none" };
}
