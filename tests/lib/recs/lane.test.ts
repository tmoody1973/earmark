import { describe, expect, it } from "vitest";
import { ProviderHttpError } from "../../../agent/lib/enrich/types";
import { isBackOffSignal, retryDelayMinutes, reviewReasonFor, SWEEP_SKIPS_STATUSES } from "../../../agent/lib/recs/lane";

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

// The brief's six cases (M3-T4 Step 5).
const base = { status: "new" as const, review_reason: null, recommender_id: 4, enrichment_status: "matched" as const };

describe("reviewReasonFor", () => {
  it("keeps an existing reason", () => {
    expect(reviewReasonFor({ ...base, review_reason: "confidence_band" })).toBe("confidence_band");
  });
  it("flags the 0.5–0.85 band", () => {
    expect(reviewReasonFor({ ...base, status: "needs_review" })).toBe("confidence_band");
  });
  it("flags a failed enrichment match", () => {
    expect(reviewReasonFor({ ...base, enrichment_status: "no_match" })).toBe("no_match");
  });
  it("flags a missing recommender (FR-04 last step)", () => {
    expect(reviewReasonFor({ ...base, recommender_id: null })).toBe("no_recommender");
  });
  it("needs nothing when typed, matched and attributed", () => {
    expect(reviewReasonFor(base)).toBeNull();
  });
  it("never flags dismissed or composted recs", () => {
    expect(reviewReasonFor({ ...base, status: "dismissed", recommender_id: null })).toBeNull();
  });
});
