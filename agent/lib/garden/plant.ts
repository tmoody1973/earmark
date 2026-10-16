import type { IdeaStage } from "../types";

export type PlantLevel = "seed" | "sprout" | "bloom" | "fruit" | "harvested";

const LEVELS: Record<IdeaStage, PlantLevel | null> = {
  compost: "seed",
  sprouting: "sprout",
  ready: "bloom",
  drafted: "fruit",
  used: "harvested",
  dismissed: null,
};

export function plantLevel(stage: IdeaStage): PlantLevel | null {
  return LEVELS[stage];
}

export function isBloomed(stage: IdeaStage): boolean {
  return stage === "ready" || stage === "drafted";
}

// "ready" (bloomed, draft not saved yet) and "drafted" are one state to the reader: saving the draft is what moves
// ready → drafted (M2-T7), so the page shows the draft or a calm "not written yet" line, never two stage names.
const LABELS: Record<IdeaStage, string> = {
  compost: "Compost",
  sprouting: "Sprouting",
  ready: "Bloomed",
  drafted: "Bloomed",
  used: "Used",
  dismissed: "Dismissed",
};

export function stageLabel(stage: IdeaStage): string {
  return LABELS[stage];
}

/** Mentions still needed to bloom (the third separate occasion blooms an idea). */
export const BLOOM_AT = 3;
export function toBloom(mentionCount: number): number {
  return Math.max(0, BLOOM_AT - mentionCount);
}

interface Orderable {
  stage: IdeaStage;
  pinned: boolean;
  flagged: boolean;
  lastMentionedAt: string | null;
}

// Pinned (Top of Mind) first, then bloomed, then newly grown (sprouting, or flagged new since the last look), then the
// rest; newest mention first inside each group. Returns a new array.
function rank(p: Orderable): number {
  if (p.pinned) return 0;
  if (isBloomed(p.stage)) return 1;
  if (p.flagged || p.stage === "sprouting") return 2;
  return 3;
}

export function gardenOrder<T extends Orderable>(plants: readonly T[]): T[] {
  const time = (p: Orderable) => (p.lastMentionedAt ? Date.parse(p.lastMentionedAt) : -Infinity);
  return [...plants].sort((a, b) => rank(a) - rank(b) || time(b) - time(a));
}
