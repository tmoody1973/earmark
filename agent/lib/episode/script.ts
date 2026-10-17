import { generateText, Output } from "ai";
import { z } from "zod";
import { getEnv, ownerFirstName } from "../env";
import type { EpisodeData } from "./data";
import { checkText, ScriptRejectedError, type Reason } from "./guard";
import { EPISODE_RULES } from "./rules";

const ScriptSchema = z.object({ title: z.string().max(80), script: z.string() });
export const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
export const MIN_WORDS = 700;
export const MAX_WORDS = 1100;

const FIX_TEXT: Record<Reason, string> = {
  owner: "Your last draft named the owner; the listener is only ever \"you\" and is never credited by name.",
  excerpt: "Your last draft had a quotation over 25 words; keep every quote to 25 words or fewer.",
  surname: "Your last draft gave a surname; use first names only.",
  unknown_name: "Your last draft named a person who is not in the data; use only first names from the data.",
};

export async function writeEpisodeScript(
  data: EpisodeData,
  weekOf: string,
  generateImpl: typeof generateText = generateText,
  owner: string | undefined = ownerFirstName(),
) {
  const ask = (extra = "") =>
    generateImpl({
      model: getEnv().WRITE_MODEL,
      instructions: EPISODE_RULES,
      output: Output.object({ schema: ScriptSchema }),
      prompt: `Week of ${weekOf}. Data:\n${JSON.stringify(data)}${extra}`,
    });
  // Title and script are both checked: the title ends up in script_md and the public-feed <title>.
  const problems = (o: { title: string; script: string }): Reason[] =>
    [...new Set([...checkText(o.script, data, owner), ...checkText(o.title, data, owner)])];
  let { output } = await ask();
  const n = wordCount(output.script);
  const reasons = problems(output);
  if (n < MIN_WORDS || n > MAX_WORDS || reasons.length) {
    const fixes = [
      n < MIN_WORDS || n > MAX_WORDS ? `Your last draft was ${n} words. Rewrite it to between 850 and 1100 words.` : "",
      ...reasons.map((r) => FIX_TEXT[r]),
    ].filter(Boolean).join(" ");
    ({ output } = await ask(`\n\n${fixes}`));
  }
  // Fail closed: a script that still fails is never voiced. The error carries reason codes only, no text.
  const left = problems(output);
  if (left.length) throw new ScriptRejectedError(left);
  return output;
}
