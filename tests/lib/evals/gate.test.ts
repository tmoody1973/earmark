import { describe, expect, it } from "vitest";
import { gateStats, MIN_GATE_N } from "../../../agent/lib/evals/gate";
import { ACCEPT_ABOVE, DROP_BELOW } from "../../../agent/lib/pipeline/thresholds";
import type { Prediction } from "../../../agent/lib/evals/metrics";

const p = (label: string, predicted: string, confidence: number): Prediction => ({ label, predicted, confidence });
const HIGH = ACCEPT_ABOVE + 0.01;
const MID = (ACCEPT_ABOVE + DROP_BELOW) / 2;
const LOW = DROP_BELOW - 0.01;

describe("gateStats", () => {
  it("measures precision only over accepted predictions (confidence > ACCEPT_ABOVE)", () => {
    const preds = [
      ...Array.from({ length: 5 }, () => p("idea_by_user", "idea_by_user", HIGH)),
      p("neither", "idea_by_user", HIGH),
      p("neither", "idea_by_user", MID), p("neither", "idea_by_user", MID),
      p("neither", "idea_by_user", LOW),
    ];
    const s = gateStats(preds, "idea_by_user");
    expect(s.accepted).toEqual({ precision: 5 / 6, n: 6, sufficient: true });
    expect(s.kept).toEqual({ precision: 5 / 8, n: 8 });
  });

  it("marks accepted precision insufficient below the minimum n", () => {
    const s = gateStats([p("rec_to_user", "rec_to_user", HIGH)], "rec_to_user");
    expect(MIN_GATE_N).toBe(5);
    expect(s.accepted).toEqual({ precision: 1, n: 1, sufficient: false });
  });

  it("has no precision when nothing of that class is accepted", () => {
    expect(gateStats([p("neither", "neither", 0.99)], "rec_to_user").accepted).toEqual({ precision: null, n: 0, sufficient: false });
  });

  it("counts labeled positives that are kept (≥ DROP_BELOW) and accepted, as coverage proxies", () => {
    const preds = [
      p("idea_by_user", "idea_by_user", HIGH),
      p("idea_by_user", "idea_by_user", MID),
      p("idea_by_user", "idea_by_user", DROP_BELOW),
      p("idea_by_user", "idea_by_user", LOW),
      p("idea_by_user", "neither", 0.99),
      p("idea_by_user", "idea_by_user", Number.NaN),
    ];
    expect(gateStats(preds, "idea_by_user").coverage).toEqual({ labeled: 6, kept: 3, accepted: 1 });
  });
});
