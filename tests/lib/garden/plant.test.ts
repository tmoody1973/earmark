import { describe, expect, it } from "vitest";
import { gardenOrder, isBloomed, plantLevel, stageLabel, toBloom } from "../../../agent/lib/garden/plant";
import type { PlantView } from "../../../agent/lib/garden/queries";

describe("plantLevel", () => {
  it("grows with the stage", () => {
    expect(plantLevel("compost")).toBe("seed");
    expect(plantLevel("sprouting")).toBe("sprout");
    expect(plantLevel("ready")).toBe("bloom");
    expect(plantLevel("drafted")).toBe("fruit");
    expect(plantLevel("used")).toBe("harvested");
    expect(plantLevel("dismissed")).toBeNull();
  });
  it("counts ready and drafted as bloomed", () => {
    expect(isBloomed("ready")).toBe(true);
    expect(isBloomed("drafted")).toBe(true);
    expect(isBloomed("sprouting")).toBe(false);
    expect(isBloomed("used")).toBe(false);
  });
});

describe("stageLabel", () => {
  it("shows ready and drafted as one state: Bloomed", () => {
    expect(stageLabel("ready")).toBe("Bloomed");
    expect(stageLabel("drafted")).toBe("Bloomed");
    expect(stageLabel("compost")).toBe("Compost");
    expect(stageLabel("sprouting")).toBe("Sprouting");
    expect(stageLabel("used")).toBe("Used");
    expect(stageLabel("dismissed")).toBe("Dismissed");
  });
});

describe("toBloom", () => {
  it("counts the mentions still needed, never below zero", () => {
    expect(toBloom(1)).toBe(2);
    expect(toBloom(2)).toBe(1);
    expect(toBloom(3)).toBe(0);
    expect(toBloom(7)).toBe(0);
  });
});

const plant = (id: number, stage: PlantView["stage"], last: string, extra: Partial<PlantView> = {}): PlantView => ({
  id, title: `idea ${id}`, stage, level: plantLevel(stage) ?? "seed", bloomed: isBloomed(stage), mentionCount: 1,
  lastMentionedAt: last, pinned: false, flagged: false, confirmed: true, latestLine: null, ...extra,
});

describe("gardenOrder", () => {
  it("puts pinned, then bloomed, then newly grown ideas first; newest first inside each group", () => {
    const out = gardenOrder([
      plant(1, "compost", "2026-10-16T10:00:00Z"),
      plant(2, "ready", "2026-10-01T10:00:00Z"),
      plant(3, "sprouting", "2026-10-02T10:00:00Z"),
      plant(4, "drafted", "2026-10-03T10:00:00Z"),
      plant(5, "compost", "2026-10-15T10:00:00Z", { flagged: true }),
      plant(6, "used", "2026-10-16T12:00:00Z"),
      plant(7, "compost", "2026-09-01T10:00:00Z", { pinned: true }),
      plant(8, "compost", "2026-10-14T10:00:00Z", { lastMentionedAt: null }),
    ]);
    expect(out.map((p) => p.id)).toEqual([7, 4, 2, 5, 3, 6, 1, 8]);
  });
  it("does not reorder its input", () => {
    const input = [plant(1, "compost", "2026-10-01T00:00:00Z"), plant(2, "ready", "2026-10-02T00:00:00Z")];
    gardenOrder(input);
    expect(input.map((p) => p.id)).toEqual([1, 2]);
  });
});
