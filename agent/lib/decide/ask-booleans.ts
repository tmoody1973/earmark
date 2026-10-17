import { experimental_decide, type Experimental_DecisionQuestion } from "ai";
import { getEnv } from "../env";

/** One literal yes/no question: the exact condition, then what counts as yes and as no (with the boundary case). */
export type BooleanQuestion = { instructions: string; whenTrue: string; whenFalse: string };

/** Several independent yes/no questions against one small state, in one Jev call. Returns P(true) per key. */
export async function askBooleans<K extends string>(
  state: Record<string, string>,
  questions: Record<K, BooleanQuestion>,
  opts: { model?: string; decideImpl?: typeof experimental_decide } = {},
): Promise<Record<K, number>> {
  const keys = Object.keys(questions) as K[];
  // JS orders integer-like keys numerically; keep every question key a word.
  if (keys.some((k) => /^\d+$/.test(k))) throw new Error("askBooleans keys must be non-numeric");
  const decide = opts.decideImpl ?? experimental_decide;
  const qs: Record<string, Experimental_DecisionQuestion> = Object.fromEntries(
    keys.map((k) => [
      k,
      { type: "boolean", instructions: questions[k].instructions, criteria: { true: questions[k].whenTrue, false: questions[k].whenFalse } },
    ]),
  );
  const result = await decide({ model: opts.model ?? getEnv().TRIAGE_MODEL, state, questions: qs });
  const answers = result.answers as Record<string, { probability?: number } | undefined>;
  return Object.fromEntries(
    keys.map((k) => {
      const p = answers[k]?.probability;
      // a missing or broken probability must fail the call, never become a stored link
      if (typeof p !== "number" || !Number.isFinite(p)) throw new Error(`askBooleans: no probability for ${k}`);
      return [k, p];
    }),
  ) as Record<K, number>;
}
