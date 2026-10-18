import { experimental_decide } from "ai";
import { getEnv } from "../env";
import { ordered } from "../pipeline/triage";
import { describeCandidate, type Candidate, type EnrichmentMatch } from "./types";

export const MATCH_ACCEPT = 0.8; // below this the rec stays unmatched (no_match → review), never a guess
export const NONE_FITS = "none_fits";
const JEV_TIMEOUT_MS = 10_000;

// Non-numeric keys: JS orders integer-like object keys numerically, which would undo the shuffle.
const keyOf = (i: number) => `m_${i}`;

export { describeCandidate };

// Jev reads literally (docs/research/triage-models.md §2): the exact condition plus boundary cases go in the wording.
// Boundary examples are synthetic (invented names), never real transcripts.
export const SAME_ITEM_INSTRUCTIONS =
  "Which candidate names the same work, place, show or person as `described_item` (what was said is in `what_was_said`)? " +
  "If none of them is that same item, choose none_fits.";

const BOUNDARY =
  "A different edition, remaster, deluxe version or format of the same album, book or film is the same item " +
  "(a 2021 remaster of 'Night Garden' by Mara Vell is the same as 'Night Garden' by Mara Vell). " +
  "A different artist or author, a cover version, a remix, a live album, a compilation, a tribute, or a different place " +
  "with a similar name is a different item ('Night Garden (Remix)', or 'Night Garden' by a tribute band, is different). " +
  "If what was said does not tell you which candidate it is, choose none_fits.";

const unquote = (s: string) => s.replaceAll('"', "'");

export function buildMatchCriteria(candidates: readonly Candidate[]): Record<string, string> {
  const criteria: Record<string, string> = {};
  candidates.forEach((c, i) => {
    criteria[keyOf(i)] = `The candidate "${unquote(describeCandidate(c))}" is the same item as described_item. ${BOUNDARY}`;
  });
  criteria[NONE_FITS] = `No candidate listed is the same item as described_item; each one is a different item. ${BOUNDARY}`;
  return criteria;
}

// One choice question with an explicit abstain option, options shuffled (Jev leans toward the first option).
export async function pickMatch(
  input: { described: string; excerpt: string },
  candidates: readonly Candidate[],
  opts: { model?: string; decideImpl?: typeof experimental_decide; random?: () => number } = {},
): Promise<EnrichmentMatch | null> {
  if (candidates.length === 0) return null;
  const decide = opts.decideImpl ?? experimental_decide;
  const result = await decide({
    model: opts.model ?? getEnv().TRIAGE_MODEL,
    state: { described_item: input.described, what_was_said: input.excerpt },
    questions: {
      match: { type: "choice", instructions: SAME_ITEM_INSTRUCTIONS, criteria: ordered(buildMatchCriteria(candidates), "shuffled", opts.random) },
    },
    abortSignal: AbortSignal.timeout(JEV_TIMEOUT_MS),
  });
  const answer = result.answers.match;
  const choice = String(answer.choice);
  const probability = answer.probabilities?.[choice] ?? Number.NaN; // no distribution → never a match
  const index = candidates.findIndex((_, i) => keyOf(i) === choice);
  if (index < 0 || !(probability >= MATCH_ACCEPT)) return null;
  return { ...candidates[index]!, matchConfidence: probability };
}
