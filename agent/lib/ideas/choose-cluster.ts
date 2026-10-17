import { experimental_decide } from "ai";
import { getEnv } from "../env";
import { ordered } from "../pipeline/triage";

export const NEW_IDEA = "new_idea";
// Jev's probability for the chosen existing idea must reach this, or the mention starts a new idea.
export const MATCH_MIN = 0.6;
export const PINNED_MATCH_MIN = 0.4; // Top of Mind (FR-35, M4): pinned ideas match more easily

// One option Jev can choose: a stored cluster (key c_<id>) or one created earlier in the same run (key n_<i>).
export interface ClusterOption { key: string; title: string; excerpt: string | null; pinned: boolean }

// Non-numeric keys: JS orders integer-like object keys numerically, which would reorder options.
export function clusterKey(id: number): string {
  return `c_${id}`;
}

const INSTRUCTIONS =
  "Is the new idea in `mention` the same idea as one of the existing ideas? Same idea means the same core proposal, " +
  "even when the wording, format or angle differs. If it is the same idea as none of them, choose new_idea.";

// Exact per-option criteria with the boundary cases (Jev rules): same core proposal = same idea; a different subject or
// a different deliverable = a different idea, even when they share a topic, a person or a place.
const DEFINITIONS =
  "Format means the medium that carries the same content: a newsletter, a radio segment or a podcast about the same " +
  "thing is the same idea. Deliverable means the thing actually made or done: an event and a history series are " +
  "different ideas even on the same topic.";

// Titles and excerpts are quoted inside the criteria: their own double quotes become single quotes so the quoting stays intact.
const unquote = (s: string) => s.replaceAll('"', "'");

export function buildClusterCriteria(options: readonly ClusterOption[]): Record<string, string> {
  const criteria: Record<string, string> = {};
  for (const o of options) {
    const title = unquote(o.title);
    const said = o.excerpt ? ` (said as: "${unquote(o.excerpt)}")` : "";
    criteria[o.key] =
      `The new idea proposes the same core thing as the existing idea "${title}"${said}. ` +
      "Choose this even when the new idea uses different words, changes the format or angle (a newsletter instead of a " +
      "radio segment, a podcast instead of an article), or adds details such as names or places. " +
      `Do not choose this when it only shares a broad topic, a person or a place with "${title}" but proposes ` +
      `a different subject or a different deliverable. ${DEFINITIONS}`;
  }
  criteria[NEW_IDEA] =
    "The new idea is not the same core proposal as any existing idea listed: compared with each of them it proposes " +
    "a different subject or a different deliverable. Choose this also when it only shares a broad topic, a person or " +
    `a place with an existing idea. ${DEFINITIONS}`;
  return criteria;
}

// Returns the accepted option key, or null (a new idea).
export function acceptMatch(choiceKey: string, probability: number, options: readonly ClusterOption[]): string | null {
  if (choiceKey === NEW_IDEA) return null;
  const match = options.find((o) => o.key === choiceKey);
  if (!match) return null;
  return probability >= (match.pinned ? PINNED_MATCH_MIN : MATCH_MIN) ? match.key : null;
}

// key: the option the mention joins, or null for a new idea. choice/probability: Jev's raw answer (for logs and evals).
export async function chooseCluster(
  idea: { title: string; excerpt: string },
  options: readonly ClusterOption[],
  opts: { model?: string; optionOrder?: "fixed" | "shuffled"; decideImpl?: typeof experimental_decide } = {},
): Promise<{ key: string | null; choice: string; probability: number }> {
  if (options.length === 0) return { key: null, choice: NEW_IDEA, probability: 1 };
  const decide = opts.decideImpl ?? experimental_decide;
  const result = await decide({
    model: opts.model ?? getEnv().TRIAGE_MODEL,
    state: { mention: `${idea.title}: ${idea.excerpt}` },
    questions: {
      cluster: { type: "choice", instructions: INSTRUCTIONS, criteria: ordered(buildClusterCriteria(options), opts.optionOrder ?? "fixed") },
    },
  });
  const answer = result.answers.cluster;
  const choice = String(answer.choice);
  const probability = answer.probabilities?.[choice] ?? Number.NaN; // no distribution → never a match
  return { key: acceptMatch(choice, probability, options), choice, probability };
}
