"use server";
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { isOwner } from "@/agent/lib/owner";
import { setLinkStatus, type LinkKey } from "@/agent/lib/garden/backlinks";
import * as spaces from "@/agent/lib/garden/spaces";
import { fillNewSpace } from "@/agent/lib/spaces/evaluate";
import { mergeClusters, undoMerge } from "@/agent/lib/garden/merge";
import { TimelineAmbiguousError } from "@/agent/lib/ideas/timeline-match";
import { setPinned, type PinResult } from "@/agent/lib/garden/top-of-mind";
import { dismissIdea, keepIdea, undoDismissIdea, UNDO_STAGES, type DismissResult, type UndoStage } from "@/agent/lib/garden/quiet-ideas";
import { getGardenVisit, saveGardenVisit, setTipChoice, setTipVerdict, type TipVerdict } from "@/agent/lib/garden/queries";
import { TIP_CHOICES, type TipChoice } from "@/agent/lib/garden/tip";
import { nextVisit } from "@/agent/lib/garden/visit";
import { compostTip, keepItem, restIdea, undoCompostTip, type CompostResult, type ItemRef } from "@/agent/lib/garden/serendipity";
import { applyTipFixProposal, ignoreTipFixProposal } from "@/agent/lib/recs/spoken-fix";

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

function tipId(id: unknown): number {
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) throw new Error("invalid tip id");
  return id;
}

// The Maybe? pile (decision 025). Server actions are public endpoints: check the owner, then the id, before any write.
async function verdict(id: unknown, v: TipVerdict): Promise<{ changed: boolean }> {
  await requireOwner();
  const changed = await setTipVerdict(tipId(id), v, { defer: after }); // status effects (Bee) run after the response
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

/**
 * A shelf card's choice (M3-T10, FR-22): Try this (queued; the Bee todo follows only when BEE_TODO_WRITES is on),
 * Tried it, Loved it / It was fine / Not for me, or Dismiss. A no-op (changed false) when the tip had moved on.
 */
export async function chooseTip(id: number, choice: TipChoice): Promise<{ changed: boolean }> {
  await requireOwner();
  const valid = tipId(id);
  if (typeof choice !== "string" || !TIP_CHOICES.includes(choice)) throw new Error("invalid choice");
  const changed = await setTipChoice(valid, choice, { defer: after }); // a tap never waits on Bee
  revalidatePath("/", "layout");
  return { changed };
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
    return mergeId === null ? { mergeId, refused: "That idea changed — try again." } : { mergeId };
  } catch (err) {
    if (err instanceof TimelineAmbiguousError) return { mergeId: null, refused: err.message };
    throw err;
  }
}

/** Undo a merge: both ideas return as they were. A no-op if it was already undone. */
export async function undoIdeaMerge(mergeId: number): Promise<{ changed: boolean; refused?: string }> {
  await requireOwner();
  const id = Id.safeParse(mergeId);
  if (!id.success) throw new Error("invalid merge id");
  const changed = await undoMerge(id.data);
  revalidatePath("/", "layout");
  return changed ? { changed } : { changed, refused: "This merge can’t be undone now: it was already undone, or one of its ideas changed or was forgotten." };
}

// ---- Top of Mind (M4-T9, FR-35) ----

/** Pin or unpin an idea. refused: why nothing changed (Top of Mind is full), in words the page shows. */
export async function pinIdea(ideaId: number, pinned: boolean): Promise<PinResult> {
  await requireOwner();
  const parsed = z.tuple([Id, z.boolean()]).safeParse([ideaId, pinned]);
  if (!parsed.success) throw new Error("invalid pin");
  const result = await setPinned(parsed.data[0], parsed.data[1]);
  revalidatePath("/", "layout"); // Home and Garden order pinned ideas first
  return result;
}

// ---- Quiet ideas (decision 055): Heard once's Keep, and Dismiss with Undo (Heard once and the idea page) ----

function ideaId(raw: unknown): number {
  const id = Id.safeParse(raw);
  if (!id.success) throw new Error("invalid idea id");
  return id.data;
}

/** Keep: an idea heard once shows in the garden now. A no-op unless it is still quiet. */
export async function keepHeardOnce(id: number): Promise<{ changed: boolean }> {
  await requireOwner();
  const changed = await keepIdea(ideaId(id));
  revalidatePath("/", "layout"); // it joins Home and the Garden
  return { changed };
}

/** Dismiss any idea that is not dismissed yet. `previous` goes back to undoDismiss. */
export async function dismissIdeaAction(id: number): Promise<DismissResult> {
  await requireOwner();
  const result = await dismissIdea(ideaId(id));
  revalidatePath("/", "layout");
  return result;
}

const UndoDismissSchema = z.strictObject({ id: Id, previous: z.enum(UNDO_STAGES) });

/** Undo a dismissal from the last hour. A no-op past the hour, or for a merge's dismissal (undo the merge instead). */
export async function undoDismissIdeaAction(ref: { id: number; previous: UndoStage }): Promise<{ changed: boolean }> {
  await requireOwner();
  const parsed = UndoDismissSchema.safeParse(ref);
  if (!parsed.success) throw new Error("invalid idea");
  const changed = await undoDismissIdea(parsed.data.id, parsed.data.previous);
  revalidatePath("/", "layout");
  return { changed };
}

// ---- Smart Spaces (M4-T7, FR-32, decision 028) ----

export type SpaceFormState = { error: string | null };
const Sentence = z.string().trim().min(3).max(200);
const SpaceName = z.string().trim().min(1).max(200);
const SpaceItemKeySchema = z.strictObject({ spaceId: Id, itemType: z.enum(["idea", "rec"]), itemId: Id });

function spaceId(raw: unknown): number {
  const id = Id.safeParse(raw);
  if (!id.success) throw new Error("invalid space id");
  return id.data;
}

/**
 * A new Space from one sentence (NewSpaceForm). Earmark starts filling it once the response is on its way (fillNewSpace:
 * 10 calls, one retry if another pass holds the lock; the hourly evaluate-spaces run does the rest; /spaces sets
 * maxDuration so it fits), and the new Space opens.
 */
export async function createSpace(_prev: SpaceFormState, form: FormData): Promise<SpaceFormState> {
  await requireOwner();
  const sentence = Sentence.safeParse(form.get("sentence") ?? "");
  if (!sentence.success) return { error: "Describe the Space in 3 to 200 characters." };
  const id = await spaces.createSpace(sentence.data);
  if (id === null) return { error: "The garden is read-only right now. Nothing was saved." };
  after(async () => {
    try {
      await fillNewSpace(id);
    } catch (err) {
      console.error(`[spaces] first fill failed space=${id} error=${err instanceof Error ? err.name : "unknown"}`);
    }
  });
  revalidatePath("/spaces");
  redirect(`/spaces/${id}`);
}

/** Renames a Space; what fills it stays its sentence. A no-op when the name is unchanged. */
export async function renameSpace(id: number, name: string): Promise<{ changed: boolean }> {
  await requireOwner();
  const sid = spaceId(id);
  const parsed = SpaceName.safeParse(name);
  if (!parsed.success) throw new Error("invalid name");
  const changed = await spaces.renameSpace(sid, parsed.data);
  revalidatePath("/spaces", "layout");
  return { changed };
}

/** Deletes a Space (the page asks first). Its ideas and tips stay where they are. */
export async function deleteSpace(id: number): Promise<{ changed: boolean }> {
  await requireOwner();
  const changed = await spaces.deleteSpace(spaceId(id));
  revalidatePath("/spaces", "layout");
  return { changed };
}

function spaceItemKey(raw: unknown): spaces.SpaceItemKey {
  const parsed = SpaceItemKeySchema.safeParse(raw);
  if (!parsed.success) throw new Error("invalid space item");
  return parsed.data;
}

/** Keep an item Earmark put in a Space. A no-op unless it is still a suggestion. */
export async function keepSpaceItem(key: spaces.SpaceItemKey): Promise<{ changed: boolean }> {
  await requireOwner();
  const changed = await spaces.setSpaceItemStatus(spaceItemKey(key), "accepted");
  revalidatePath("/spaces", "layout");
  return { changed };
}

/** Take an item out of a Space. It is never put back. */
export async function removeSpaceItem(key: spaces.SpaceItemKey): Promise<{ changed: boolean }> {
  await requireOwner();
  const changed = await spaces.setSpaceItemStatus(spaceItemKey(key), "removed");
  revalidatePath("/spaces", "layout");
  return { changed };
}

// ---- Serendipity (M4-T8, FR-34, decision 029) ----

const ItemRefSchema = z.strictObject({ type: z.enum(["rec", "idea"]), id: Id });
const UndoSchema = z.strictObject({ id: Id, previous: z.enum(["new", "queued"]) });

function serendipityId(raw: unknown): number {
  const parsed = Id.safeParse(raw);
  if (!parsed.success) throw new Error("invalid item");
  return parsed.data;
}

/** Keep it: it stays where it is, and Serendipity moves on to the next forgotten thing. */
export async function keepSerendipity(ref: ItemRef): Promise<{ changed: boolean }> {
  await requireOwner();
  const parsed = ItemRefSchema.safeParse(ref);
  if (!parsed.success) throw new Error("invalid item");
  const changed = await keepItem(parsed.data);
  revalidatePath("/");
  return { changed };
}

/** Not now (an idea): it rests out of Serendipity for a couple of months, still in the garden and still growing. */
export async function notNowSerendipity(ideaId: number): Promise<{ changed: boolean }> {
  await requireOwner();
  const changed = await restIdea(serendipityId(ideaId));
  revalidatePath("/");
  return { changed };
}

/** Let it compost (a tip): composted, and its Bee todo is cleared after the response. Undoable for an hour. */
export async function compostSerendipity(recId: number): Promise<CompostResult> {
  await requireOwner();
  const result = await compostTip(serendipityId(recId), { defer: after });
  revalidatePath("/", "layout"); // the shelf loses it too
  return result;
}

/** Undo a tip's compost from Serendipity. A no-op past the hour, or for a tip composted anywhere else. */
export async function undoCompostSerendipity(ref: { id: number; previous: "new" | "queued" }): Promise<{ changed: boolean }> {
  await requireOwner();
  const parsed = UndoSchema.safeParse(ref);
  if (!parsed.success) throw new Error("invalid item");
  const changed = await undoCompostTip(parsed.data.id, parsed.data.previous, { defer: after });
  revalidatePath("/", "layout");
  return { changed };
}

// ---- Fixes said out loud (decision 049, piece 3) ----

function fixId(raw: unknown): number {
  const parsed = Id.safeParse(raw);
  if (!parsed.success) throw new Error("invalid fix");
  return parsed.data;
}

/**
 * Apply a fix Tarik said out loud: the tip takes the new words through applyTipFix and is looked up again. changed false:
 * already applied or ignored. refused: the tip was cleared or changed since, in words the page shows.
 */
export async function applySpokenFix(id: number): Promise<{ changed: boolean } | { refused: string }> {
  await requireOwner();
  const r = await applyTipFixProposal(fixId(id));
  revalidatePath("/", "layout"); // Home, Shelf, People and the tip page all show the tip
  return r.refused ? { refused: "That tip was cleared or changed since, so nothing was fixed." } : { changed: r.changed };
}

/** Ignore it: the proposal goes away and the tip stays as it is. A no-op unless it is still waiting. */
export async function ignoreSpokenFix(id: number): Promise<{ changed: boolean }> {
  await requireOwner();
  const r = await ignoreTipFixProposal(fixId(id));
  revalidatePath("/");
  return r;
}
