"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { MusicAuthError, saveMusicUserToken } from "@/agent/lib/music/library";
import { requireOwner } from "@/app/gardeners/owner";

// The owner's Apple Music sign-in (decision 065). Server actions are public endpoints: the owner first, then the input.
// The token is never logged or returned; it is stored encrypted (agent/lib/music/crypto.ts).

const Token = z.string().trim().min(20).max(4000);

export async function connectAppleMusic(musicUserToken: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireOwner();
  const parsed = Token.safeParse(musicUserToken);
  if (!parsed.success) return { ok: false, error: "Apple Music didn’t return a sign-in. Try again." };
  try {
    await saveMusicUserToken(parsed.data);
  } catch (err) {
    console.error(`[music] connect failed err=${err instanceof Error ? err.name : "unknown"}`);
    return { ok: false, error: err instanceof MusicAuthError ? "Apple Music refused that sign-in. Try again." : "Couldn’t reach Apple Music. Try again." };
  }
  revalidatePath("/music");
  return { ok: true };
}
