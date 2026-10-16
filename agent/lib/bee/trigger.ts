// Trigger must open the voice note (optionally after a filler word), so "we earmarked that budget" never matches.
// Speech-to-text variants: "ear mark", "ear-mark"; "that" or "this".
// Stacked leading fillers/addressees are allowed; "that's" is not a trigger; punctuation may split the two words.
const TRIGGER =
  /^\s*(?:(?:ok(?:ay)?|so|um+|uh+|hey|alright|and|well|please|bee)\b[\s,.!—–-]*)*ear[\s-]?mark[\s,.]+(?:that|this)(?![\w'’])[\s,.:;!?…—–-]*([\s\S]*)$/i;

export function parseEarmarkTrigger(text: string): { matched: false } | { matched: true; body: string } {
  const m = TRIGGER.exec(text);
  if (!m) return { matched: false };
  const body = (m[1] ?? "").trim().replace(/[.!?…]+$/, "").trim();
  return body ? { matched: true, body } : { matched: false }; // ponytail: empty body needs live context (M2); skip for now
}
