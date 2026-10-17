import { z } from "zod";

// Base shape: what the proposing model fills in. LabelSchema adds the cross-field rule a human label must satisfy.
export const ProposalSchema = z.object({
  kind: z.enum(["idea_by_user", "rec_to_user", "rec_by_user", "neither"]),
  rec_type: z.enum(["album", "song", "artist", "book", "place", "podcast", "film_tv", "other", "none"]),
  joking: z.boolean(),
  notes: z.string(),
});
const REC_KINDS = new Set(["rec_to_user", "rec_by_user"]);
export const LabelSchema = ProposalSchema.refine(
  (l) => REC_KINDS.has(l.kind) === (l.rec_type !== "none"),
  { message: "rec kinds (rec_to_user, rec_by_user) need a t= other than none; idea_by_user and neither need t=none" },
);
export type Label = z.infer<typeof LabelSchema>;
export type LabeledSnippet = Label & { id: string; window: string };

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
  if (next.kind !== proposal.kind && !typed && !REC_KINDS.has(String(next.kind))) next.rec_type = "none";
  const parsed = LabelSchema.safeParse(next);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "invalid label");
  return parsed.data;
}

// A broken model proposal is fixed rather than shown: non-rec kinds get none; a rec kind with none becomes other.
export function normalizeProposal(p: z.infer<typeof ProposalSchema>): Label {
  if (!REC_KINDS.has(p.kind)) return { ...p, rec_type: "none" };
  return p.rec_type === "none" ? { ...p, rec_type: "other" } : p;
}

// One JSON object per line. A killed write can leave a partial LAST line: drop it and count it; a bad line elsewhere throws.
export function parseJsonl<T>(text: string): { rows: T[]; skipped: number } {
  const lines = text.split("\n").filter(Boolean);
  const rows: T[] = [];
  let skipped = 0;
  lines.forEach((l, i) => {
    try { rows.push(JSON.parse(l) as T); } catch (err) {
      if (i !== lines.length - 1) throw err;
      skipped++;
    }
  });
  return { rows, skipped };
}
