import { describe, expect, it } from "vitest";
import { buildModelReport, renderReportMarkdown, type SnippetRun } from "../../../agent/lib/evals/report";

const r = (kind: string, p: number, recType = "none", j = 0.1) => ({ kind, kindProbability: p, recType, jokingProbability: j });
const runs: SnippetRun[] = [
  { id: "1-0", label: { kind: "rec_to_user", rec_type: "album", joking: false },
    results: [r("rec_to_user", 0.95, "album"), r("rec_to_user", 0.93, "album"), r("rec_to_user", 0.94, "song")] },
  { id: "2-0", label: { kind: "idea_by_user", rec_type: "none", joking: false },
    results: [r("idea_by_user", 0.8, "none", 0.2), r("neither", 0.55, "none", 0.2), r("idea_by_user", 0.75, "none", 0.2)] },
];

describe("buildModelReport", () => {
  it("aggregates every order's prediction and prices input tokens", () => {
    const m = buildModelReport("typesafe-ai/jev-1.13.0", runs, 2_000_000);
    expect(m.n).toBe(2);
    expect(m.predictions).toHaveLength(6);
    expect(m.accuracy).toBeCloseTo(5 / 6, 6);
    expect(m.recPrecision).toBe(1);
    expect(m.ideaPrecision).toBe(1);
    expect(m.flipRate).toBe(0.5);
    expect(m.recTypeAccuracy).toBeCloseTo(2 / 3, 6);
    expect(m.jokingAccuracy).toBe(1);
    expect(m.costUsd).toBeCloseTo(0.084, 6);
    expect(JSON.stringify(m)).not.toContain("window");
  });

  it("flip rate looks only at the shuffled runs (fixed order excluded)", () => {
    const flippy: SnippetRun = { id: "x", label: runs[0]!.label, results: [r("neither", 0.9), r("rec_to_user", 0.9), r("rec_to_user", 0.9)] };
    expect(buildModelReport("m", [flippy], 0).flipRate).toBe(0);
  });

  it("measures the work-talk and room-wide subsets separately by tag", () => {
    const work: SnippetRun = { id: "w", tags: ["work_talk"], label: { kind: "neither", rec_type: "none", joking: false },
      results: [r("neither", 0.9), r("idea_by_user", 0.9), r("neither", 0.9)] };
    const room: SnippetRun = { id: "r", tags: ["room_wide"], label: { kind: "rec_to_user", rec_type: "other", joking: false },
      results: [r("rec_by_user", 0.9, "other"), r("rec_by_user", 0.9, "other"), r("rec_to_user", 0.9, "other")] };
    const m = buildModelReport("m", [...runs, work, room], 0);
    expect(m.subsets.work_talk).toEqual({ n: 1, accuracy: 2 / 3, predicted: { neither: 2, idea_by_user: 1 } });
    expect(m.subsets.room_wide).toEqual({ n: 1, accuracy: 1 / 3, predicted: { rec_by_user: 2, rec_to_user: 1 } });
  });

  it("a subset is null when no snippet carries the tag", () => {
    expect(buildModelReport("m", runs, 0).subsets.work_talk).toBeNull();
  });
});

describe("renderReportMarkdown", () => {
  it("renders a table row per model", () => {
    const m = buildModelReport("typesafe-ai/jev-1.13.0", runs, 1000);
    const md = renderReportMarkdown({ date: "2026-10-18", labeledCount: 2, triageModel: m.model, models: { [m.model]: m } });
    expect(md).toContain("| typesafe-ai/jev-1.13.0 |");
  });
});
