import type { IdeaStage } from "../types";

// Created early by M4-T2 so queries.ts resolves; M4-T3 owns it and adds its tests.
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
