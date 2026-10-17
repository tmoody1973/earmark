import { describe, expect, it } from "vitest";
import { accuracy, brier, ece, flipRate, precisionFor, reliabilityTable, type Prediction } from "../../../agent/lib/evals/metrics";

// conf 0.9 right, 0.9 wrong, 0.2 right, 0.6 right
const preds: Prediction[] = [
  { label: "rec_to_user", predicted: "rec_to_user", confidence: 0.9 },
  { label: "neither", predicted: "rec_to_user", confidence: 0.9 },
  { label: "idea_by_user", predicted: "idea_by_user", confidence: 0.2 },
  { label: "neither", predicted: "neither", confidence: 0.6 },
];

describe("metrics", () => {
  it("accuracy", () => expect(accuracy(preds)).toBe(0.75));

  it("precision for a class, null when the class was never predicted", () => {
    expect(precisionFor(preds, "rec_to_user")).toEqual({ precision: 0.5, predicted: 2 });
    expect(precisionFor(preds, "rec_by_user")).toEqual({ precision: null, predicted: 0 });
  });

  it("ECE over 10 equal-width bins: 2/4·|0.5−0.9| + 1/4·|1−0.2| + 1/4·|1−0.6| = 0.5", () => {
    expect(ece(preds)).toBeCloseTo(0.5, 10);
  });

  it("Brier on the chosen option: (0.01 + 0.81 + 0.64 + 0.16) / 4 = 0.405", () => {
    expect(brier(preds)).toBeCloseTo(0.405, 10);
  });

  it("reliability table lists only non-empty bins with count, mean confidence and accuracy", () => {
    expect(reliabilityTable(preds)).toEqual([
      { lo: 0.2, hi: 0.3, count: 1, meanConfidence: 0.2, accuracy: 1 },
      { lo: 0.6, hi: 0.7, count: 1, meanConfidence: 0.6, accuracy: 1 },
      { lo: 0.9, hi: 1, count: 2, meanConfidence: 0.9, accuracy: 0.5 },
    ]);
  });

  it("confidence 1.0 lands in the top bin, not an 11th", () => {
    expect(reliabilityTable([{ label: "a", predicted: "a", confidence: 1 }])[0]).toMatchObject({ lo: 0.9, hi: 1 });
  });

  it("flip rate = share of snippets whose prediction changed across option orders", () => {
    expect(flipRate([["a", "a", "a"], ["a", "b", "a"], ["c", "c", "c"], ["d", "d", "e"]])).toBe(0.5);
  });

  it("empty input gives 0, not NaN", () => {
    expect(accuracy([])).toBe(0);
    expect(ece([])).toBe(0);
    expect(brier([])).toBe(0);
  });
});
