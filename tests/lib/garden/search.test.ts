import { describe, expect, it } from "vitest";
import { matchesQuery } from "../../../agent/lib/garden/search";

describe("matchesQuery (the on-page filter until M5-T8's memory-cue search)", () => {
  it("an empty query shows everything", () => {
    expect(matchesQuery("", ["Kawa Ramen", "Ann"])).toBe(true);
    expect(matchesQuery("   ", [])).toBe(true);
  });

  it("matches titles and first names, ignoring case and accents", () => {
    expect(matchesQuery("ramen", ["Kawa Ramen", "Ann"])).toBe(true);
    expect(matchesQuery("ANN", ["Kawa Ramen", "Ann"])).toBe(true);
    expect(matchesQuery("jose", ["Café tip", "José"])).toBe(true);
    expect(matchesQuery("cafe", ["Café tip", null])).toBe(true);
  });

  it("every word must match somewhere, across fields", () => {
    expect(matchesQuery("ramen ann", ["Kawa Ramen", "Ann"])).toBe(true);
    expect(matchesQuery("ramen marcus", ["Kawa Ramen", "Ann"])).toBe(false);
  });

  it("ignores missing fields", () => {
    expect(matchesQuery("ann", [null, undefined, "Shogun"])).toBe(false);
  });
});
