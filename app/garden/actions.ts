"use server";
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { isOwner } from "@/agent/lib/owner";
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
