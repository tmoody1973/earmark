import { describe, expect, it } from "vitest";
import { ProviderHttpError } from "../../../agent/lib/enrich/types";
import { isBackOffSignal, retryDelayMinutes, SWEEP_SKIPS_STATUSES } from "../../../agent/lib/recs/lane";

describe("rec lane rules", () => {
  it("backs off 15 min, 1 h, 4 h, 16 h after failed attempts 1-4", () => {
    expect([1, 2, 3, 4].map(retryDelayMinutes)).toEqual([15, 60, 240, 960]);
  });

  it("a 503 or 429 from any provider stops the sweep; other failures are per-rec", () => {
    expect(isBackOffSignal(new ProviderHttpError("musicbrainz.org", 503))).toBe(true);
    expect(isBackOffSignal(new ProviderHttpError("openlibrary.org", 429))).toBe(true);
    expect(isBackOffSignal(new ProviderHttpError("openlibrary.org", 500))).toBe(false);
    expect(isBackOffSignal(Object.assign(new Error("t"), { name: "TimeoutError" }))).toBe(false);
  });

  it("enriches maybes (needs_review) but never dismissed or composted tips", () => {
    expect([...SWEEP_SKIPS_STATUSES].sort()).toEqual(["composted", "dismissed"]);
  });
});
