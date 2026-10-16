import { generateText, Output } from "ai";
import { z } from "zod";
import { getEnv } from "../env";
import { clampExcerpt } from "../pipeline/excerpt";

export const TIMELINE_TZ = "America/Chicago";
export const NOTE_FIRST = "first heard";
export const NOTE_AGAIN = "mentioned again";

export interface TimelineEntry { date: string; line: string }

export function formatTimelineDate(d: Date, timeZone = TIMELINE_TZ): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone }).format(d);
}

export function timelineLine(d: Date, note: string): string {
  return `${formatTimelineDate(d)}: ${clampExcerpt(note.trim(), 12)}`;
}

// The jsonb array literal the join/create statements append: the date is the mention's own time, formatted by code.
export function timelineEntryJson(d: Date, note: string): string {
  return JSON.stringify([{ date: d.toISOString(), line: timelineLine(d, note) } satisfies TimelineEntry]);
}

export async function writeTimelineNote(
  input: { clusterTitle: string; priorLines: string[]; excerpt: string },
  opts: { generateImpl?: typeof generateText } = {},
): Promise<string> {
  const run = opts.generateImpl ?? generateText;
  const { output } = await run({
    model: getEnv().EXTRACT_MODEL,
    output: Output.object({ schema: z.object({ note: z.string().min(1) }) }),
    abortSignal: AbortSignal.timeout(20_000),
    prompt: [
      `You keep a one-line timeline of how a spoken idea grew. The idea: "${input.clusterTitle}".`,
      input.priorLines.length ? `Earlier timeline lines:\n${input.priorLines.map((l) => `- ${l}`).join("\n")}` : "There are no earlier lines.",
      `New mention (verbatim excerpt): "${clampExcerpt(input.excerpt)}"`,
      "Write what this mention adds compared with the earlier lines, in at most 12 words.",
      "No date, no quotation marks, lower-case start, past tense (e.g. 'added a radio segment angle', 'named three possible guests').",
      "If it adds nothing new, write 'restated the idea'.",
    ].join("\n\n"),
  });
  const note = clampExcerpt(output.note.replace(/^[A-Z][a-z]{2} \d{1,2}:\s*/, "").trim(), 12);
  if (!note) throw new Error("empty timeline note");
  return note;
}
