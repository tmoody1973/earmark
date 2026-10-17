"use server";
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isOwner } from "@/agent/lib/owner";
import { setLinkStatus, type LinkKey } from "@/agent/lib/garden/backlinks";
import { mergeClusters, undoMerge } from "@/agent/lib/garden/merge";
import { TimelineAmbiguousError } from "@/agent/lib/ideas/timeline-match";
import { getGardenVisit, saveGardenVisit, setTipVerdict, type TipVerdict } from "@/agent/lib/garden/queries";
import { nextVisit } from "@/agent/lib/garden/visit";

async function requireOwner(): Promise<void> {
  const { userId } = await auth();
  if (!isOwner(userId)) throw new Error("not found");
}

/**
 * Records that the owner is looking at the garden (decision 023). Called by GardenLive when the page mounts and when
 * the tab becomes visible again, never by a server render, so router.refresh() cannot count as a look.
 * `started`: this look began a new visit (the New row's baseline moved), so the page should refresh.
 */
export async function recordGardenVisit(): Promise<{ started: boolean }> {
  await requireOwner();
  const { next, started } = nextVisit(await getGardenVisit(), new Date());
  await saveGardenVisit(next);
  return { started };
}

// The Maybe? pile (decision 025). Server actions are public endpoints: check the owner, then the id, before any write.
async function verdict(id: unknown, v: TipVerdict): Promise<{ changed: boolean }> {
  await requireOwner();
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) throw new Error("invalid tip id");
  const changed = await setTipVerdict(id, v);
  revalidatePath("/", "layout"); // Home, Shelf and People all read these tips
  return { changed };
}

/** Keep: the tip joins the shelf (status new). A no-op unless it is still a maybe. */
export async function keepTip(id: number): Promise<{ changed: boolean }> {
  return verdict(id, "kept");
}

/** Not a tip: the tip is dismissed. A no-op unless it is still a maybe. */
export async function notATip(id: number): Promise<{ changed: boolean }> {
  return verdict(id, "not_a_tip");
}

// ---- backlinks (M4-T6, FR-38) ----

const Id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const IdeaPairKey = z.strictObject({
  fromType: z.literal("idea"), fromId: Id, toType: z.literal("idea"), toId: Id, kind: z.enum(["related", "merge_suggestion"]),
});
const FitsKey = z.strictObject({ fromType: z.literal("rec"), fromId: Id, toType: z.literal("idea"), toId: Id, kind: z.literal("fits") });
const LinkKeySchema = z.union([IdeaPairKey, FitsKey]);

function linkKey(raw: unknown, { allowSameIdea }: { allowSameIdea: boolean }): LinkKey {
  const parsed = LinkKeySchema.safeParse(raw);
  // accepting "same idea" is the merge itself, which has its own confirmed action (mergeIdeas)
  if (!parsed.success || (!allowSameIdea && parsed.data.kind === "merge_suggestion")) throw new Error("invalid link");
  return parsed.data;
}

/** Keep a suggested link (related idea, or a tip that fits). A no-op unless it is still a suggestion. */
export async function acceptLink(key: LinkKey): Promise<{ changed: boolean }> {
  await requireOwner();
  const changed = await setLinkStatus(linkKey(key, { allowSameIdea: false }), "accepted");
  revalidatePath("/", "layout");
  return { changed };
}

/** Remove a link, or answer "not the same idea" to a merge suggestion. It is never suggested again. */
export async function removeLink(key: LinkKey): Promise<{ changed: boolean }> {
  await requireOwner();
  const changed = await setLinkStatus(linkKey(key, { allowSameIdea: true }), "removed");
  revalidatePath("/", "layout");
  return { changed };
}

/** Merge `mergedId` into `keepId` (decision 027: reversible). mergeId null: nothing changed (already merged). */
// refused: why nothing changed, in words the page can show (ids only, never idea text)
export async function mergeIdeas(keepId: number, mergedId: number): Promise<{ mergeId: number | null; refused?: string }> {
  await requireOwner();
  const ids = z.tuple([Id, Id]).safeParse([keepId, mergedId]);
  if (!ids.success || ids.data[0] === ids.data[1]) throw new Error("invalid idea id");
  try {
    const mergeId = await mergeClusters(ids.data[0], ids.data[1]);
    revalidatePath("/", "layout");
    return { mergeId };
  } catch (err) {
    if (err instanceof TimelineAmbiguousError) return { mergeId: null, refused: err.message };
    throw err;
  }
}

/** Undo a merge: both ideas return as they were. A no-op if it was already undone. */
export async function undoIdeaMerge(mergeId: number): Promise<{ changed: boolean }> {
  await requireOwner();
  const id = Id.safeParse(mergeId);
  if (!id.success) throw new Error("invalid merge id");
  const changed = await undoMerge(id.data);
  revalidatePath("/", "layout");
  return { changed };
}
