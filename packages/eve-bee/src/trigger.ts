// THE one "Earmark that" matcher: voice notes and the completed-conversation pass both use it.
// Trigger must open the note/utterance (optionally after filler words), so "we earmarked that budget" and
// "I'd remark that the weather…" never match.
// Speech-to-text variants: "ear mark", "ear-mark", and Bee's real mishearing "remark"; "that" or "this".
// Stacked leading fillers/addressees are allowed; "that's" is not a trigger; punctuation may split the two words.
const TRIGGER =
  /^\s*(?:(?:ok(?:ay)?|so|um+|uh+|hey|alright|and|well|please|bee)\b[\s,.!—–-]*)*(?:ear[\s-]?|re)mark[\s,.]+(?:that|this)(?![\w'’])[\s,.:;!?…—–-]*([\s\S]*)$/i;

// body may be empty ("Earmark that." alone): the item is then in the utterances that follow.
export function detectEarmarkTrigger(text: string): { matched: false } | { matched: true; body: string } {
  const m = TRIGGER.exec(text);
  if (!m) return { matched: false };
  return { matched: true, body: (m[1] ?? "").trim().replace(/[.!?…]+$/, "").trim() };
}

// Voice notes: the whole note is one item, so a trigger with nothing after it saves nothing.
export function parseEarmarkTrigger(text: string): { matched: false } | { matched: true; body: string } {
  const t = detectEarmarkTrigger(text);
  return t.matched && t.body ? t : { matched: false };
}
