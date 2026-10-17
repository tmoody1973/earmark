import { describe, expect, it } from "vitest";
import { pickAcceptThreshold, pickDropThreshold } from "../../../agent/lib/evals/tune";
import type { Prediction } from "../../../agent/lib/evals/metrics";

const p = (label: string, predicted: string, confidence: number): Prediction => ({ label, predicted, confidence });

describe("pickAcceptThreshold", () => {
  it("picks the lowest candidate where accepted rec and idea predictions meet both targets", () => {
    const preds = [
      p("rec_to_user", "rec_to_user", 0.97), p("rec_to_user", "rec_to_user", 0.92), p("neither", "rec_to_user", 0.62),
      p("idea_by_user", "idea_by_user", 0.9), p("neither", "idea_by_user", 0.58),
    ];
    expect(pickAcceptThreshold(preds, { rec: 0.85, idea: 0.75 }).threshold).toBe(0.65);
  });
  it("falls back to 0.95 when no candidate meets the targets", () => {
    const preds = [p("neither", "rec_to_user", 0.99), p("rec_to_user", "rec_to_user", 0.99)];
    expect(pickAcceptThreshold(preds, { rec: 0.85, idea: 0.75 }).threshold).toBe(0.95);
  });
  it("reports how many accepted positives the precision rests on", () => {
    const preds = [p("idea_by_user", "idea_by_user", 0.9), p("rec_to_user", "rec_to_user", 0.97), p("neither", "neither", 0.99)];
    expect(pickAcceptThreshold(preds, { rec: 0.85, idea: 0.75 })).toMatchObject({ threshold: 0.5, recAccepted: 1, ideaAccepted: 1 });
  });
});

describe("pickDropThreshold", () => {
  it("raises the drop line while the positives below it are mostly wrong", () => {
    const preds = [
      p("neither", "rec_to_user", 0.32), p("neither", "idea_by_user", 0.41), p("neither", "rec_to_user", 0.48),
      p("rec_to_user", "rec_to_user", 0.56), p("rec_to_user", "rec_to_user", 0.58),
    ];
    expect(pickDropThreshold(preds, 0.85)).toBe(0.5);
  });
  it("keeps the 0.5 default when there is no low-confidence evidence", () => {
    expect(pickDropThreshold([p("rec_to_user", "rec_to_user", 0.95)], 0.85)).toBe(0.5);
  });
  it("never returns a drop line at or above the accept line", () => {
    const preds = [p("neither", "rec_to_user", 0.55), p("neither", "rec_to_user", 0.59)];
    expect(pickDropThreshold(preds, 0.55)).toBeLessThan(0.55);
  });
});
