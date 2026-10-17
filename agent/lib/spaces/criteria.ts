import type { BooleanQuestion } from "../decide/ask-booleans";

// Smart Spaces (FR-32, M4-T7, decision 028). Tuning knob: a starting point, adjust after Tarik looks at real Spaces
// (M4-T11). An item shows in a Space when Jev's P(yes) is at or above this, or when Tarik kept it.
export const SPACE_MIN = 0.7;

/** askBooleans keys must be words (JS orders integer-like keys numerically). */
export const spaceKey = (spaceId: number) => `s_${spaceId}`;

// Jev reads literally (docs/research/triage-models.md §2): the instruction names the state field and quotes Tarik's
// sentence exactly; each side states what counts, with the boundary case. Examples are synthetic, never transcript text.
export function spaceQuestion(sentence: string): BooleanQuestion {
  return {
    instructions: `Does the item in \`item\` belong in the collection described as: "${sentence}"?`,
    whenTrue:
      "The item is what the description asks for, or plainly could become it, and meets every condition the " +
      "description states (a kind of thing, a place, a person, a purpose). Example: for \"places to eat in Milwaukee\", " +
      "a ramen restaurant in Milwaukee; for \"radio segment ideas\", an idea for a weekly visit to a record store.",
    whenFalse:
      "The item is a different kind of thing, misses a condition the description states, or shares only a topic, a " +
      "place or a word with it. Example: for \"places to eat in Milwaukee\", a Milwaukee record store, or a ramen " +
      "restaurant in Chicago.",
  };
}
