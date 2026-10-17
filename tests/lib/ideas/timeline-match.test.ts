import { describe, expect, it } from "vitest";
import { lineIndexFor, TimelineAmbiguousError } from "../../../agent/lib/ideas/timeline-match";

const T = "2026-10-05T15:00:00.000Z";
const U = "2026-10-06T15:00:00.000Z";

// A timeline line belongs to one mention (M4-T6). New lines carry mention_id; legacy lines (written before) only a date.
describe("lineIndexFor", () => {
  it("finds a line by its mention id, even when another line shares the moment and the words", () => {
    const tl = [{ date: T, line: "Oct 5: same words", mention_id: 1 }, { date: T, line: "Oct 5: same words", mention_id: 2 }];
    expect(lineIndexFor(tl, { id: 2, spokenAt: T }, 9)).toBe(1);
    expect(lineIndexFor(tl, { id: 1, spokenAt: new Date(T) }, 9)).toBe(0);
  });

  it("a legacy line (no mention id) is this mention's only when it is the one line at that moment", () => {
    expect(lineIndexFor([{ date: U, line: "a" }, { date: T, line: "b" }], { id: 3, spokenAt: T }, 9)).toBe(1);
  });

  it("refuses when two lines share the moment and neither names this mention", () => {
    const tl = [{ date: T, line: "a" }, { date: T, line: "b", mention_id: 7 }];
    expect(() => lineIndexFor(tl, { id: 3, spokenAt: T }, 9)).toThrow(TimelineAmbiguousError);
    expect(() => lineIndexFor(tl, { id: 3, spokenAt: T }, 9)).toThrow("idea 9: two timeline lines share this moment; can't tell which is this mention");
  });

  it("no line: -1 (a moved mention that had none takes no kept-idea line)", () => {
    expect(lineIndexFor([{ date: U, line: "a" }], { id: 3, spokenAt: T }, 9)).toBe(-1);
    // the one line at that moment belongs to another mention
    expect(lineIndexFor([{ date: T, line: "a", mention_id: 8 }], { id: 3, spokenAt: T }, 9)).toBe(-1);
  });
});
