import { db } from "../db";
import { buildSaveQueries, savedIds, type SaveItem } from "../pipeline/save-item";
import type { Source } from "../types";

export interface NewIdeaMention {
  beeConversationId: number | null;
  beeJournalId: string | null;
  excerpt: string;
  spokenAt: Date;
  confidence: number;
  reviewStatus: "accepted" | "needs_review";
  source: Source;
}

/**
 * @deprecated use buildSaveQueries inside the claim transaction (M1 final review). Kept for the M1 contract only;
 * it delegates to buildSaveQueries so its SQL (and the 25-word clamp) cannot drift.
 */
export async function createClusterWithMention(m: NewIdeaMention & { title: string }): Promise<{ clusterId: number; mentionId: number }> {
  const item: SaveItem = {
    kind: "idea", route: m.reviewStatus === "accepted" ? "accept" : "review", extraction: { title: m.title, excerpt: m.excerpt },
    beeConversationId: m.beeConversationId, beeJournalId: m.beeJournalId, spokenAt: m.spokenAt, confidence: m.confidence, source: m.source,
  };
  const saved = savedIds([item], await db().transaction((txn) => buildSaveQueries(txn, item)));
  return { clusterId: saved.ideaClusterIds[0]!, mentionId: saved.mentionIds[0]! };
}
