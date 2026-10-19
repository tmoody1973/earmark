// Tarik edits a tip's todo text in the Bee app to correct it (decision 049): "Earmark · Listen: Jemetta Rose's new
// albums, Jemetta Rose (Oct 16) …" becomes "… Listen: Lanquidity, Sun Ra (Oct 16) …". This reads the new words as a
// TipFix. The format is ours (todo-text.ts), so a plain parse comes first; only a free rewrite goes to one small model
// call, which sees the two todo texts and nothing else (never the excerpt or any transcript text). The reconciler
// (bee-todos.ts) applies the fix. Logs: none here; the reconciler logs ids and err.name only.
import { generateText, Output } from "ai";
import { z } from "zod";
import { REC_TYPES } from "../enrich/registry";
import { getEnv } from "../env";
import type { TipFix, TipNow } from "../recs/fix-tip";
import type { RecType } from "../types";
import { TODO_PREFIX, TODO_VERB } from "./todo-text";

type Words = Pick<TipNow, "type" | "canonical_name" | "creator">;
// bee_sync.last_written_state for a tip's todo. seen: an edit of his already read and left alone (not a fix).
type WrittenState = { text?: unknown; completed?: unknown; seen?: unknown } | null;
export type TodoEditAction = "none" | "refresh" | "adopt" | "fix";

/**
 * What Bee's text for a tip's open todo means, against the text Earmark last wrote and the tip's text now. Pure.
 * refresh: untouched by Tarik but the tip's words changed (the tip page, the lane's name). adopt: Bee already shows the
 * tip's text (a run that crashed before saving). fix: his edit, not yet read.
 */
export function todoEditAction(last: WrittenState, text: string, formatted: string): TodoEditAction {
  if (typeof last?.text !== "string") return "none"; // nothing recorded: no edit can be told apart
  if (text === last.text) return text === formatted ? "none" : "refresh";
  if (text === formatted) return "adopt";
  return text === last.seen ? "none" : "fix";
}

const typesFor = (verb: string) => REC_TYPES.filter((t) => TODO_VERB[t] === verb);
// A changed verb names the type only when it has one (Read, Visit, Try); Listen and Watch have several.
const typeIfVerbChanged = (verb: string, now: RecType): { type?: RecType } | null => {
  if (verb === TODO_VERB[now]) return {};
  const types = typesFor(verb);
  return types.length === 1 ? { type: types[0] } : null;
};

/**
 * The fix in an edit that kept Earmark's format, or null when it can't be sure. The link and the "(who, day)" may be
 * gone; a comma in the tip's current name or creator is kept whole. Pure.
 */
export function parseTodoEdit(edited: string, now: Words): TipFix | null {
  const line = edited.trim()
    .replace(/\s+https?:\/\/\S+$/, "")
    .replace(/\s*\((?:[^()]*, )?[A-Z][a-z]{2} \d{1,2}\)$/, ""); // only the (who, day) Earmark wrote
  const m = new RegExp(`^(?:${TODO_PREFIX.trim()}\\s*)?([A-Za-z]+):\\s*(.*)$`, "s").exec(line);
  const verb = m && Object.values(TODO_VERB).find((v) => v.toLowerCase() === m[1]!.toLowerCase());
  const type = verb ? typeIfVerbChanged(verb, now.type) : null;
  if (!m || !type) return null;
  const what = m[2]!.trim();
  let name: string;
  let creator: string | null;
  if (what === now.canonical_name) [name, creator] = [what, null];
  else if (now.creator && what.endsWith(`, ${now.creator}`)) [name, creator] = [what.slice(0, -now.creator.length - 2), now.creator];
  else if (what.startsWith(`${now.canonical_name}, `)) [name, creator] = [now.canonical_name, what.slice(now.canonical_name.length + 2)];
  else {
    const i = what.lastIndexOf(", ");
    [name, creator] = i < 0 ? [what, null] : [what.slice(0, i), what.slice(i + 2)];
  }
  name = name.trim();
  return name ? { name, creator: creator?.trim() || null, ...type } : null;
}

const EditSchema = z.object({
  correction: z.boolean(),
  name: z.string().max(200),
  creator: z.string().max(200),
  type: z.enum(REC_TYPES),
});

/** The fix in Tarik's edit of `written`: the plain parse, else one small model call. null: not a fix he made. */
export async function readTodoEdit(
  written: string, edited: string, now: Words, generateImpl: typeof generateText = generateText,
): Promise<TipFix | null> {
  const parsed = parseTodoEdit(edited, now);
  if (parsed) return parsed;
  const verbs = REC_TYPES.map((t) => `${t}: ${TODO_VERB[t]}`).join(", ");
  const { output } = await generateImpl({
    model: getEnv().EXTRACT_MODEL,
    output: Output.object({ schema: EditSchema }),
    // Privacy: only the two todo texts, never the excerpt or what was said.
    prompt: `Earmark wrote this to-do about a recommendation: ${JSON.stringify(written)}. Its format is "Earmark · <verb>: <name>, <creator> (<who>, <day>) <link>", and the verb follows the type (${verbs}). The owner edited it to: ${JSON.stringify(edited)}. If the edit corrects which thing was recommended (its name, creator or type), set correction true and give the corrected name, the creator (empty if none) and the type. If it is anything else (a note to self, a reminder, unrelated words), set correction false.`,
  });
  const name = output.name.trim();
  if (!output.correction || !name) return null;
  return { name, creator: output.creator.trim() || null, ...(TODO_VERB[output.type] === TODO_VERB[now.type] ? {} : { type: output.type }) };
}
