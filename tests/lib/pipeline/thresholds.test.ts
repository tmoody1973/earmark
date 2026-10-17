import { describe, expect, it } from "vitest";
import { ACCEPT_ABOVE, DROP_BELOW, JOKING_MAX, routeByConfidence, windowRoute } from "../../../agent/lib/pipeline/thresholds";
import type { TriageResult } from "../../../agent/lib/types";

describe("routeByConfidence", () => {
  it.each([
    [0.99, "accept"],
    [ACCEPT_ABOVE + 1e-7, "accept"],
    [ACCEPT_ABOVE, "review"],
    [(ACCEPT_ABOVE + DROP_BELOW) / 2, "review"],
    [DROP_BELOW, "review"],
    [DROP_BELOW - 1e-4, "drop"],
    [0, "drop"],
    [Number.NaN, "drop"],
    [Number.POSITIVE_INFINITY, "drop"],
  ])("%s → %s", (p, route) => {
    expect(routeByConfidence(p)).toBe(route);
  });
});

// M2-T10, decision 009: chosen from the labeled eval (evals/triage/reports/2026-10-17.md), not the PRD starting points.
describe("tuned thresholds", () => {
  it("accepts only above 0.9 and drops below 0.6", () => {
    expect(ACCEPT_ABOVE).toBe(0.9);
    expect(DROP_BELOW).toBe(0.6);
  });
});

describe("JOKING_MAX", () => {
  it("is 0.5", () => {
    expect(JOKING_MAX).toBe(0.5);
  });
});

describe("windowRoute (the gates the completed and live paths share)", () => {
  const t = (over: Partial<TriageResult> = {}): TriageResult => ({
    kind: "idea_by_user", kindProbability: 0.93, recType: "none", recTypeProbability: 0.9,
    jokingProbability: 0.05, broadcastProbability: 0.02, model: "m", providerMetadata: null, ...over,
  });
  it.each([
    ["an accepted idea", t(), "accept"],
    ["a review-band idea", t({ kindProbability: 0.7 }), "review"],
    ["a low-confidence idea", t({ kindProbability: 0.3 }), null],
    ["neither", t({ kind: "neither" }), null],
    ["the user's own recommendation", t({ kind: "rec_by_user" }), null],
    ["a joke (above JOKING_MAX)", t({ jokingProbability: 0.51 }), null],
    ["a joke exactly at JOKING_MAX (kept)", t({ jokingProbability: 0.5 }), "accept"],
    ["broadcast audio", t({ broadcastProbability: 0.9 }), null],
    ["a missing broadcast answer (fail closed)", t({ broadcastProbability: Number.NaN }), null],
    ["a rec to the user", t({ kind: "rec_to_user" }), "accept"],
  ])("%s → %s", (_label, triage, route) => {
    expect(windowRoute(triage)).toBe(route);
  });
});
