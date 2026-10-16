import type { IdeaStage } from "../types";

const STICKY: readonly IdeaStage[] = ["drafted", "used", "dismissed"];

// Mirrored in SQL by idea_stage_for() (db/migrations/003_compost.sql), which the save statement uses so the stage
// follows the row's own count; an integration test keeps the two equal.
export function stageFor(current: IdeaStage, mentionCount: number): IdeaStage {
  if (STICKY.includes(current)) return current;
  if (mentionCount >= 3) return "ready";
  if (mentionCount === 2) return "sprouting";
  return "compost";
}

export function isNewBloom(prev: IdeaStage, next: IdeaStage): boolean {
  return prev !== "ready" && next === "ready";
}
