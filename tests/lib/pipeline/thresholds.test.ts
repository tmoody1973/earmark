import { describe, expect, it } from "vitest";
import { JOKING_MAX, routeByConfidence } from "../../../agent/lib/pipeline/thresholds";

describe("routeByConfidence", () => {
  it.each([
    [0.99, "accept"],
    [0.8500001, "accept"],
    [0.85, "review"],
    [0.7, "review"],
    [0.5, "review"],
    [0.4999, "drop"],
    [0, "drop"],
    [Number.NaN, "drop"],
    [Number.POSITIVE_INFINITY, "drop"],
  ])("%s → %s", (p, route) => {
    expect(routeByConfidence(p)).toBe(route);
  });
});

describe("JOKING_MAX", () => {
  it("is 0.5", () => {
    expect(JOKING_MAX).toBe(0.5);
  });
});
