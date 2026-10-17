import { stageFor } from "../ideas/stage";
import type { IdeaStage } from "../types";
import { routeByConfidence } from "./thresholds";

// Re-sort of rows saved before the tuned thresholds (M2-T10b, decision 010). Pure: the script reads, this plans.
export type ResortTable = "recommendations" | "idea_mentions";
export interface ResortRow {
  table: ResortTable;
  id: number;
  status: string; // recommendations.status or idea_mentions.review_status
  confidence: number | null;
  source: string;
  deliberateKey: string | null;
}
export interface ResortMove {
  table: ResortTable;
  id: number;
  from: string;
  to: string;
  confidence: number;
}

// Only what triage itself put there: rec statuses Tarik sets (queued/tried/thanked/dismissed) and composted are never
// eligible; a dismissed mention stays dismissed (decision 004).
const ELIGIBLE: Record<ResortTable, readonly string[]> = {
  recommendations: ["new", "needs_review"],
  idea_mentions: ["accepted", "needs_review"],
};
const ROUTED: Record<ResortTable, Record<"accept" | "review" | "drop", string>> = {
  recommendations: { accept: "new", review: "needs_review", drop: "dismissed" },
  idea_mentions: { accept: "accepted", review: "needs_review", drop: "dismissed" },
};

function target(r: ResortRow): string | null {
  // Deliberate captures are explicit requests (decision 007): source 'voice' (voice notes, "Earmark that" said in a
  // conversation, and their raw fallbacks, all saved at confidence 1), or any row carrying a deliberate_key. Only
  // ambient rows were routed by confidence in the first place.
  if (r.source !== "ambient" || r.deliberateKey !== null) return null;
  if (!ELIGIBLE[r.table].includes(r.status)) return null;
  if (r.confidence === null || !Number.isFinite(r.confidence)) return null; // routeByConfidence would drop it; leave it
  // A 'new' rec at accept stays 'new' (from === to below), so only a needs_review rec above 0.9 moves up.
  return ROUTED[r.table][routeByConfidence(r.confidence)];
}

export function planResort(rows: readonly ResortRow[]): ResortMove[] {
  return rows.flatMap((r) => {
    const to = target(r);
    return to && to !== r.status ? [{ table: r.table, id: r.id, from: r.status, to, confidence: r.confidence! }] : [];
  });
}

export interface ClusterRow {
  id: number;
  stage: IdeaStage;
  mentionCount: number;
}
export interface ClusterMove {
  id: number;
  fromStage: IdeaStage;
  toStage: IdeaStage;
  fromCount: number;
  toCount: number;
}

// An idea's count is its non-dismissed mentions (accepted and needs_review both count, decision 004), so only a move
// into or out of 'dismissed' changes it. Delta, not a recount: the re-sort changes exactly what it moved, and undo
// reverses exactly that. Stage via stageFor (= SQL idea_stage_for), so drafted/used/dismissed never move.
export function planClusters(
  mentionMoves: readonly { clusterId: number; from: string; to: string }[],
  clusters: readonly ClusterRow[],
): ClusterMove[] {
  const delta = new Map<number, number>();
  for (const m of mentionMoves) {
    const d = (m.from === "dismissed" ? 1 : 0) - (m.to === "dismissed" ? 1 : 0);
    delta.set(m.clusterId, (delta.get(m.clusterId) ?? 0) + d);
  }
  return clusters.flatMap((c) => {
    const toCount = Math.max(0, c.mentionCount + (delta.get(c.id) ?? 0));
    if (toCount === c.mentionCount) return [];
    return [{ id: c.id, fromStage: c.stage, toStage: stageFor(c.stage, toCount), fromCount: c.mentionCount, toCount }];
  });
}
