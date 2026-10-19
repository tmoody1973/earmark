"use server";
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { isOwner } from "@/agent/lib/owner";
import { setTipVerdict, type TipVerdict } from "@/agent/lib/garden/queries";

// Heard nearby (decision 052). Server actions are public endpoints: the owner first, then the id, before any write.
const Id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

async function verdict(id: unknown, v: TipVerdict): Promise<{ changed: boolean }> {
  const { userId } = await auth();
  if (!isOwner(userId)) throw new Error("not found");
  const p = Id.safeParse(id);
  if (!p.success) throw new Error("invalid tip id");
  const changed = await setTipVerdict(p.data, v, { pile: "heard", defer: after }); // status effects run after the response
  revalidatePath("/", "layout"); // a kept tip joins Home and the Shelf
  return { changed };
}

/** Keep: the tip joins the shelf (status new) and the rec lane looks it up. A no-op unless it is still overheard. */
export async function keepHeard(id: number): Promise<{ changed: boolean }> {
  return verdict(id, "kept");
}

/** Clear: the tip is dismissed. A no-op unless it is still overheard. */
export async function clearHeard(id: number): Promise<{ changed: boolean }> {
  return verdict(id, "not_a_tip");
}
