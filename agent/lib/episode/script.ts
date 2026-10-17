import { generateText, Output } from "ai";
import { z } from "zod";
import { getEnv, ownerFirstName } from "../env";
import type { EpisodeData } from "./data";
import { findIssues, ScriptRejectedError, type Reason } from "./guard";
import { EPISODE_RULES } from "./rules";

const ScriptSchema = z.object({ title: z.string().max(80), script: z.string() });
export const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
export const MIN_WORDS = 700; // hard floor; the retry asks for 850-1100, so only clearly short drafts are redone
export const MAX_WORDS = 1100;

const MAX_ATTEMPTS = 3; // first draft plus two retries
export const FIX_TEXT: Record<Reason, string> = {
  owner: "Never name the owner; the listener is only \"you\".",
  excerpt: "Keep every quotation to 25 words or fewer.",
  surname: "Use first names only; never add a surname.",
  unknown_name: "Name only people whose first names appear in the data.",
};

export async function writeEpisodeScript(
  data: EpisodeData,
  weekOf: string,
  generateImpl: typeof generateText = generateText,
  owner: string | undefined = ownerFirstName(),
  onAttempt?: (info: { attempt: number; reasons: Reason[] }) => void, // codes only, for dry runs
) {
  const ask = (extra = "") =>
    generateImpl({
      model: getEnv().WRITE_MODEL,
      instructions: EPISODE_RULES,
      output: Output.object({ schema: ScriptSchema }),
      prompt: `Week of ${weekOf}. Data:\n${JSON.stringify(data)}${extra}`,
    });
  // Title and script are both checked: the title ends up in script_md and the public-feed <title>.
  const issuesOf = (o: { title: string; script: string }) => [...findIssues(o.script, data, owner), ...findIssues(o.title, data, owner)];
  let extra = "";
  for (let attempt = 1; ; attempt++) {
    const { output } = await ask(extra);
    const n = wordCount(output.script);
    const issues = issuesOf(output);
    const reasons = [...new Set(issues.map((i) => i.reason))];
    const badLength = n < MIN_WORDS || n > MAX_WORDS;
    onAttempt?.({ attempt, reasons });
    if (!badLength && !issues.length) return output;
    if (attempt === MAX_ATTEMPTS) {
      // Fail closed: a script that still fails is never voiced. The error carries reason codes only, no text.
      if (issues.length) throw new ScriptRejectedError(reasons);
      return output; // length-only miss after the retries is accepted
    }
    // The offending phrases go only into this in-memory request, never into logs, errors or return values.
    extra = "\n\n" + [
      badLength ? `Your last draft was ${n} words. Rewrite it to between 850 and 1100 words.` : "",
      ...reasons.map((r) => FIX_TEXT[r]),
      issues.length ? `Do not write these phrases; refer to people by first name only: ${[...new Set(issues.map((i) => `"${i.phrase}"`))].join(", ")}.` : "",
    ].filter(Boolean).join(" ");
  }
}
