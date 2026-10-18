import { describe, expect, it } from "vitest";
import { asksWhichOne, readCandidates, whichOneView, type WhichOneRow } from "../../../agent/lib/garden/which-one";
import { describeCandidate } from "../../../agent/lib/enrich/match";

// "Which one?" (decision 048): when the tip page asks, when it offers a correction, and what each option shows.
const A = { provider: "tmdb", canonicalName: "Shogun", creator: null, yearOrAddress: "1980", imageUrl: "http://image.tmdb.org/a.jpg", links: {} };
const B = { provider: "tmdb", canonicalName: "Shogun", creator: null, yearOrAddress: "2024", detail: "TV series", imageUrl: null, links: {} };
const base: WhichOneRow = {
  canonical_name: "Shogun", status: "new", enrichment_status: "no_match", match_source: "auto", owner_none_at: null,
  match_candidates: [A, B], auto_pick: "none", candidates_at: "2026-10-02T00:00:00Z", enriched_at: "2026-10-02T00:00:00Z",
};

describe("asksWhichOne (the card's chip)", () => {
  const chip = { enrichment_status: "no_match", match_source: "auto", owner_none_at: null, has_candidates: true };
  it("asks on an unmatched or second-look tip that has candidates", () => {
    expect(asksWhichOne(chip)).toBe(true);
    expect(asksWhichOne({ ...chip, enrichment_status: "pending" })).toBe(true);
  });
  it("never once matched, answered None of these, settled by the owner, without candidates, or on a row that didn't say", () => {
    expect(asksWhichOne({ ...chip, enrichment_status: "matched" })).toBe(false);
    expect(asksWhichOne({ ...chip, owner_none_at: "2026-10-03T00:00:00Z" })).toBe(false);
    expect(asksWhichOne({ ...chip, match_source: "owner" })).toBe(false);
    expect(asksWhichOne({ ...chip, has_candidates: false })).toBe(false);
    expect(asksWhichOne({})).toBe(false); // a public page's row never selects these columns
  });
});

describe("whichOneView (the tip page section)", () => {
  it("asks with every stored option: name, maker, year or address, detail; art only over https", () => {
    const v = whichOneView(base)!;
    expect(v.mode).toBe("ask");
    expect(v.query).toBe("Shogun");
    expect(v.options).toEqual([
      { index: 0, name: "Shogun", creator: null, yearOrAddress: "1980", detail: null, imageUrl: "https://image.tmdb.org/a.jpg", lat: null, lng: null },
      { index: 1, name: "Shogun", creator: null, yearOrAddress: "2024", detail: "TV series", imageUrl: null, lat: null, lng: null },
    ]);
  });
  it("still asks after a search that found nothing, so Search again stays reachable", () => {
    expect(whichOneView({ ...base, match_candidates: [] })).toMatchObject({ mode: "ask", options: [] });
  });
  it("a confident auto match offers the others (not its own pick) behind 'Not the right one?'", () => {
    const v = whichOneView({ ...base, enrichment_status: "matched", auto_pick: describeCandidate(A) })!;
    expect(v.mode).toBe("correct");
    expect(v.options.map((o) => o.index)).toEqual([1]);
  });
  it("no correction with a single candidate, unless the owner searched since", () => {
    const one = { ...base, enrichment_status: "matched", match_candidates: [A], auto_pick: describeCandidate(A) };
    expect(whichOneView(one)).toBeNull();
    expect(whichOneView({ ...one, candidates_at: "2026-10-03T00:00:00Z" })).toMatchObject({ mode: "correct", options: [] });
  });
  it("nothing once the owner settled it, said none, the tip was cleared, or no candidates were kept", () => {
    expect(whichOneView({ ...base, match_source: "owner" })).toBeNull();
    expect(whichOneView({ ...base, owner_none_at: "2026-10-03T00:00:00Z" })).toBeNull();
    expect(whichOneView({ ...base, status: "dismissed" })).toBeNull();
    expect(whichOneView({ ...base, match_candidates: null })).toBeNull();
  });
  it("a music candidate with no art shows its Cover Art Archive thumbnail (a well-formed id only)", () => {
    const rg = "0f4b5e7c-8d1a-4c3b-9e2f-1a2b3c4d5e6f";
    const v = whichOneView({ ...base, match_candidates: [{ ...B, releaseGroupId: rg }, { ...B, releaseGroupId: "../x" }] })!;
    expect(v.options[0]!.imageUrl).toBe(`https://coverartarchive.org/release-group/${rg}/front-250`);
    expect(v.options[1]!.imageUrl).toBeNull();
  });
});

describe("readCandidates", () => {
  it("keeps well-formed stored candidates, drops anything else, never more than three", () => {
    expect(readCandidates(null)).toEqual([]);
    expect(readCandidates("x")).toEqual([]);
    expect(readCandidates([A, { canonicalName: 4 }, B, A, B])).toHaveLength(3);
    expect(readCandidates([{ canonicalName: 4 }, A])).toEqual([A]);
  });
});
