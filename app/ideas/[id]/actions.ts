"use server";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { gardenReadOnly } from "@/agent/lib/e2e-guard";
import { requestResearch, runIdeaResearch } from "@/agent/lib/ideas/research";
import { requireOwner } from "@/app/gardeners/owner";

export type ResearchResult = { requested: boolean; note?: string };

const NOTE = {
  missing: "This idea is gone.",
  busy: "Already researching.",
  recent: "Researched a moment ago. Try again in a few minutes.",
} as const;

/**
 * Research this / Research again (decision 057). Server actions are public endpoints: owner first, then the id. The
 * research itself starts once the response is on its way (the idea page sets maxDuration so it fits); the rec-lane
 * schedule picks it up if that run doesn't finish it. Logs ids and err.name only.
 */
export async function researchIdea(ideaId: number): Promise<ResearchResult> {
  await requireOwner();
  const id = z.number().int().positive().safeParse(ideaId);
  if (!id.success) throw new Error("invalid idea id");
  if (gardenReadOnly()) return { requested: false, note: "Research is off in this demo." };
  if (!process.env.TINYFISH_API_KEY?.trim()) return { requested: false, note: "Research isn’t set up yet." };
  const r = await requestResearch(id.data);
  if (!r.requested) return { requested: false, note: NOTE[r.reason] };
  after(async () => {
    try {
      console.log(`[research] idea=${id.data} run`, JSON.stringify(await runIdeaResearch({ onlyIds: [id.data] })));
    } catch (err) {
      console.error(`[research] idea=${id.data} run failed error=${err instanceof Error ? err.name : "unknown"}`);
    }
  });
  revalidatePath(`/ideas/${id.data}`);
  return { requested: true };
}
