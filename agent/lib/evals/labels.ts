import { z } from "zod";

export const LabelSchema = z.object({
  kind: z.enum(["idea_by_user", "rec_to_user", "rec_by_user", "neither"]),
  rec_type: z.enum(["album", "song", "artist", "book", "place", "podcast", "film_tv", "other", "none"]),
  joking: z.boolean(),
  notes: z.string(),
});
export type Label = z.infer<typeof LabelSchema>;
export type LabeledSnippet = Label & { id: string; window: string };

const HAS_REC = new Set(["rec_to_user", "rec_by_user"]);

// Enter accepts, s skips, q quits; otherwise k= t= j=y|n n=… override single fields (notes take the rest of the line).
export function parseOverride(input: string, proposal: Label): Label | "skip" | "quit" {
  const line = input.trim();
  if (line === "") return proposal;
  if (line === "s") return "skip";
  if (line === "q") return "quit";
  const next: Record<string, unknown> = { ...proposal };
  const notesAt = line.search(/(^|\s)n=/);
  const head = notesAt >= 0 ? line.slice(0, notesAt) : line;
  if (notesAt >= 0) next.notes = line.slice(notesAt).replace(/^\s*n=/, "");
  let typed = false;
  for (const token of head.split(/\s+/).filter(Boolean)) {
    const [key, value] = token.split("=");
    if (key === "k") next.kind = value;
    else if (key === "t") { next.rec_type = value; typed = true; }
    else if (key === "j") {
      if (value !== "y" && value !== "n") throw new Error("j must be y or n");
      next.joking = value === "y";
    } else throw new Error(`unknown field "${key}" — use k=, t=, j=y|n, n=`);
  }
  // Changing the kind to one that has no rec to type clears the old rec type, unless t= was given too.
  if (next.kind !== proposal.kind && !typed && !HAS_REC.has(String(next.kind))) next.rec_type = "none";
  return LabelSchema.parse(next);
}
