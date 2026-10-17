import { generateText, Output } from "ai";
import { z } from "zod";
import { getEnv, ownerFirstName } from "../env";
import type { EpisodeData } from "./data";
import { EPISODE_RULES } from "./rules";

const ScriptSchema = z.object({ title: z.string().max(80), script: z.string() });
export const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
export const MIN_WORDS = 700;
export const MAX_WORDS = 1100;

export const namesPerson = (text: string, name: string | undefined): boolean =>
  !!name && new RegExp(`(?<![\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "iu").test(text);

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
  let { output } = await ask();
  const n = wordCount(output.script);
  const credits = namesPerson(output.script, owner);
  if (n < MIN_WORDS || n > MAX_WORDS || credits) {
    const fixes = [
      n < MIN_WORDS || n > MAX_WORDS ? `Your last draft was ${n} words. Rewrite it to between 750 and 1050 words.` : "",
      credits ? "Your last draft named the owner; the listener is only ever \"you\" and is never credited by name." : "",
    ].filter(Boolean).join(" ");
    ({ output } = await ask(`\n\n${fixes}`));
  }
  // Fail closed: a script that still credits the owner is never voiced. The message carries no script text.
  if (namesPerson(output.script, owner)) throw new Error("script credits the owner");
  return output;
}
