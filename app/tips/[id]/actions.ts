"use server";
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { MAX_CANDIDATES } from "@/agent/lib/enrich/types";
import { isOwner } from "@/agent/lib/owner";
import { noneOfThese, pickCandidate, searchAgain, type SearchResult } from "@/agent/lib/recs/which-one";

// "Which one?" (decision 048). Server actions are public endpoints: the owner first, then every input, before any read.

async function requireOwner(): Promise<void> {
  const { userId } = await auth();
  if (!isOwner(userId)) throw new Error("not found");
}

const Id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const Index = z.number().int().min(0).max(MAX_CANDIDATES - 1);
const Query = z.string().trim().min(2).max(120);
const Key = z.string().min(1).max(1000); // candidateKey: compared, never stored from here

function parse<T>(schema: z.ZodType<T>, v: unknown, what: string): T {
  const p = schema.safeParse(v);
  if (!p.success) throw new Error(`invalid ${what}`);
  return p.data;
}

// Home, Shelf, People and the tip page all show the tip (and its chip).
const refresh = () => revalidatePath("/", "layout");

/**
 * "This one": the owner's pick, final. `key` names the option the page showed; changed false when the stored options
 * moved on since (the page refreshes to show them).
 */
export async function chooseWhichOne(id: number, index: number, key: string): Promise<{ changed: boolean }> {
  await requireOwner();
  const r = await pickCandidate(parse(Id, id, "tip id"), parse(Index, index, "candidate"), parse(Key, key, "candidate"));
  refresh();
  return r;
}

/** "None of these": final; the question goes away. */
export async function noneOfTheseTip(id: number): Promise<{ changed: boolean }> {
  await requireOwner();
  const r = await noneOfThese(parse(Id, id, "tip id"));
  refresh();
  return r;
}

const REFUSED: Record<Extract<SearchResult, { status: "refused" }>["reason"], string> = {
  busy: "That service is busy. Try again in a bit.",
  too_soon: "One moment: one search every 10 seconds.",
  not_configured: "Search isn’t set up for this kind of tip yet.",
  gone: "This tip changed. Reload to see it.",
  failed: "That search didn’t work. Try again.",
};

/** "Search again": new options with the owner's words, nothing picked. refused: why, in words the page can show. */
export async function searchWhichOne(id: number, query: string): Promise<{ found?: number; refused?: string }> {
  await requireOwner();
  const r = await searchAgain(parse(Id, id, "tip id"), parse(Query, query, "search"));
  if (r.status === "refused") return { refused: REFUSED[r.reason] };
  refresh();
  return { found: r.found };
}
