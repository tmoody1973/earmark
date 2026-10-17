"use server";
import { auth } from "@clerk/nextjs/server";
import { isOwner } from "@/agent/lib/owner";
import { getGardenVisit, saveGardenVisit } from "@/agent/lib/garden/queries";
import { nextVisit } from "@/agent/lib/garden/visit";

/**
 * Records that the owner is looking at the garden (decision 023). Called by GardenLive when the page mounts and when
 * the tab becomes visible again, never by a server render, so router.refresh() cannot count as a look.
 * `started`: this look began a new visit (the New row's baseline moved), so the page should refresh.
 */
export async function recordGardenVisit(): Promise<{ started: boolean }> {
  const { userId } = await auth();
  if (!isOwner(userId)) throw new Error("not found");
  const { next, started } = nextVisit(await getGardenVisit(), new Date());
  await saveGardenVisit(next);
  return { started };
}
