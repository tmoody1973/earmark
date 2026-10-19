import { experimental_decide } from "ai";
import { getEnv } from "../env";
import type { ItemKind, RecType, TriageResult } from "../types";
import {
  BROADCAST_INSTRUCTIONS, CORRECTION_INSTRUCTIONS, JOKING_INSTRUCTIONS, KIND_CRITERIA, KIND_INSTRUCTIONS, REC_TYPE_CRITERIA, REC_TYPE_INSTRUCTIONS,
} from "./criteria";

// The triage model failed for a whole conversation or voice note (gateway down, bad key, no probabilities):
// callers release the claim so the backfill retries later, instead of burning the item as "nothing found".
export class SystemicTriageError extends Error {
  override name = "SystemicTriageError";
  constructor(readonly reason: "all_failed" | "no_probabilities", options?: { cause?: unknown }) {
    super(`triage failed systemically: ${reason}`, options);
  }
}

export function ordered(criteria: Record<string, string>, order: "fixed" | "shuffled", random: () => number = Math.random): Record<string, string> {
  if (order === "fixed") return criteria;
  const keys = Object.keys(criteria);
  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [keys[i], keys[j]] = [keys[j]!, keys[i]!];
  }
  return Object.fromEntries(keys.map((k) => [k, criteria[k]!]));
}

// correction: also ask whether a deliberate earmark corrects a saved tip (decision 049). Ambient windows never set it,
// so their questions stay exactly as they were.
export async function triageWindow(
  text: string,
  opts: { model?: string; optionOrder?: "fixed" | "shuffled"; random?: () => number; decideImpl?: typeof experimental_decide; correction?: boolean } = {},
): Promise<TriageResult> {
  const model = opts.model ?? getEnv().TRIAGE_MODEL;
  const decide = opts.decideImpl ?? experimental_decide;
  const order = opts.optionOrder ?? "fixed";
  const result = await decide({
    model,
    state: { window: text },
    questions: {
      kind: { type: "choice", instructions: KIND_INSTRUCTIONS, criteria: ordered(KIND_CRITERIA, order, opts.random) },
      rec_type: { type: "choice", instructions: REC_TYPE_INSTRUCTIONS, criteria: ordered(REC_TYPE_CRITERIA, order, opts.random) },
      joking: { type: "boolean", instructions: JOKING_INSTRUCTIONS },
      broadcast: { type: "boolean", instructions: BROADCAST_INSTRUCTIONS },
      ...(opts.correction ? { correction: { type: "boolean" as const, instructions: CORRECTION_INSTRUCTIONS } } : {}),
    },
  });
  const kind = result.answers.kind;
  const recType = result.answers.rec_type;
  return {
    kind: kind.choice as ItemKind,
    // no distribution → NaN → later thresholds treat it as drop, never auto-accepted
    kindProbability: kind.probabilities?.[kind.choice] ?? Number.NaN,
    recType: recType.choice as RecType | "none",
    recTypeProbability: recType.probabilities?.[recType.choice] ?? Number.NaN,
    jokingProbability: result.answers.joking.probability,
    broadcastProbability: result.answers.broadcast.probability,
    ...(opts.correction ? { correctionProbability: (result.answers as Record<string, { probability?: number } | undefined>).correction?.probability } : {}),
    model,
    providerMetadata: result.providerMetadata,
  };
}
