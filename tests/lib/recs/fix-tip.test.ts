import { describe, expect, it } from "vitest";
import { planTipFix, TipFixSchema, type TipNow } from "../../../agent/lib/recs/fix-tip";

// Decision 049: the owner fixes a tip's words. The rules every way in (web, Bee todo edit, spoken) shares.
const now: TipNow = { type: "album", canonical_name: "Jemetta Rose's new albums", creator: "Jemetta Rose", context_summary: "On Sun Raw Records." };

describe("TipFixSchema", () => {
  it("trims, and an empty creator or note means clear it", () => {
    expect(TipFixSchema.parse({ name: "  Sun Ra ", creator: "  ", note: "" })).toEqual({ name: "Sun Ra", creator: null, note: null });
    expect(TipFixSchema.parse({ creator: null, note: null })).toEqual({ creator: null, note: null });
  });

  it.each([
    [{}], [{ name: "" }], [{ name: "   " }], [{ name: "x".repeat(121) }], [{ creator: "x".repeat(121) }],
    [{ note: "x".repeat(281) }], [{ type: "poem" }], [{ name: 4 }], [{ quote: "what Bee heard" }],
  ])("refuses %j", (fix) => {
    expect(TipFixSchema.safeParse(fix).success).toBe(false);
  });

  it("takes the longest allowed values and every tip type", () => {
    expect(TipFixSchema.safeParse({ name: "x".repeat(120), creator: "x".repeat(120), note: "x".repeat(280) }).success).toBe(true);
    for (const type of ["album", "song", "artist", "book", "place", "podcast", "film_tv", "video", "other"]) {
      expect(TipFixSchema.safeParse({ type }).success).toBe(true);
    }
  });
});

describe("planTipFix", () => {
  it("a new name, creator or type looks the tip up again; the rest stays", () => {
    expect(planTipFix(now, { name: "Sun Ra" })).toEqual({
      type: "album", name: "Sun Ra", creator: "Jemetta Rose", note: "On Sun Raw Records.", relook: true, renote: false,
    });
    expect(planTipFix(now, { creator: null })).toMatchObject({ creator: null, relook: true });
    expect(planTipFix(now, { type: "artist" })).toMatchObject({ type: "artist", relook: true });
  });

  it("a note alone is written, with no new lookup", () => {
    expect(planTipFix(now, { note: "On Sun Ra's label." })).toMatchObject({ note: "On Sun Ra's label.", relook: false, renote: true });
    expect(planTipFix(now, { note: null })).toMatchObject({ note: null, relook: false, renote: true });
  });

  it("the same words are no change at all (null), but a change of case is a change", () => {
    expect(planTipFix(now, { name: now.canonical_name, creator: now.creator, type: now.type, note: now.context_summary })).toBeNull();
    expect(planTipFix({ ...now, creator: null, context_summary: null }, { creator: null, note: null })).toBeNull();
    expect(planTipFix(now, { creator: "jemetta rose" })).toMatchObject({ relook: true });
  });
});
