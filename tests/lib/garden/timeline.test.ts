import { describe, expect, it } from "vitest";
import { growthSteps, heardLine, parseTimeline, timelineNote } from "../../../agent/lib/garden/timeline";

describe("parseTimeline", () => {
  it("sorts by date (stored in processing order), keeps ties in stored order, drops junk", () => {
    const out = parseTimeline([
      { date: "2026-10-15T14:40:00.000Z", line: "Oct 15: suggested starting small" },
      { date: "2026-09-12T16:20:00.000Z", line: "Sep 12: proposed a CRM" },
      { date: "2026-10-03T21:05:00.000Z", line: "Oct 3: linked donors to shows" },
      { date: "2026-10-03T21:05:00.000Z", line: "Oct 3: said it again" },
      { nope: true },
      { date: "not a date", line: "x" },
      { date: "2026-10-01T00:00:00.000Z", line: "" },
      "string",
    ]);
    expect(out.map((e) => e.line)).toEqual([
      "Sep 12: proposed a CRM",
      "Oct 3: linked donors to shows",
      "Oct 3: said it again",
      "Oct 15: suggested starting small",
    ]);
  });
  it("returns [] for non-arrays", () => {
    expect(parseTimeline(null)).toEqual([]);
    expect(parseTimeline({})).toEqual([]);
  });
});

describe("timelineNote", () => {
  it("drops the code-written date prefix, keeps the note", () => {
    expect(timelineNote("Oct 6: first heard")).toBe("first heard");
    expect(timelineNote("Sep 12: proposed a CRM: stations first")).toBe("proposed a CRM: stations first");
    expect(timelineNote("no prefix here")).toBe("no prefix here");
  });
});

describe("heardLine", () => {
  it("writes the stage, count and first/last dates in Chicago time", () => {
    expect(
      heardLine({ stage: "drafted", mentionCount: 3, first: "2026-10-06T15:00:00Z", last: "2026-10-18T15:00:00Z" }),
    ).toBe("Bloomed · 3 mentions · first heard Oct 6 · last Oct 18");
  });
  it("uses the Chicago date, not UTC (late evening stays on its own day)", () => {
    // 02:30 UTC on Oct 7 is 21:30 on Oct 6 in Chicago
    expect(heardLine({ stage: "compost", mentionCount: 1, first: "2026-10-07T02:30:00Z", last: "2026-10-07T02:30:00Z" }))
      .toBe("Compost · 1 mention · heard Oct 6");
  });
  it("says it once when every mention fell on the same day", () => {
    expect(heardLine({ stage: "ready", mentionCount: 3, first: "2026-10-08T14:35:40Z", last: "2026-10-08T20:00:00Z" }))
      .toBe("Bloomed · 3 mentions · heard Oct 8");
  });
  it("leaves dates out when there are none", () => {
    expect(heardLine({ stage: "sprouting", mentionCount: 2, first: null, last: null })).toBe("Sprouting · 2 mentions");
  });
});

describe("growthSteps", () => {
  const entries = parseTimeline([
    { date: "2026-10-03T21:05:00.000Z", line: "Oct 3: linked donors" },
    { date: "2026-09-12T16:20:00.000Z", line: "Sep 12: proposed a CRM" },
    { date: "2026-10-15T14:40:00.000Z", line: "Oct 15: start small" },
    { date: "2026-10-16T14:40:00.000Z", line: "Oct 16: a line with no mention row" },
  ]);
  const mentions = [
    { id: 1, spokenAt: "2026-09-12T16:20:00.000Z", excerpt: "a CRM built for stations", source: "ambient", reviewStatus: "accepted" },
    { id: 2, spokenAt: "2026-10-03T21:05:00.000Z", excerpt: "connects donors to shows", source: "voice", reviewStatus: "needs_review" },
    { id: 3, spokenAt: "2026-10-15T14:40:00.000Z", excerpt: null, source: "ambient", reviewStatus: "dismissed" },
  ] as const;

  it("pairs each line with its mention by time, oldest first, and labels the source", () => {
    const steps = growthSteps(entries, [...mentions]);
    expect(steps.map((s) => [s.dateLabel, s.note, s.source, s.excerpt, s.unconfirmed])).toEqual([
      ["Sep 12", "proposed a CRM", "Bee conversation", "a CRM built for stations", false],
      ["Oct 3", "linked donors", "Voice note", "connects donors to shows", true],
      ["Oct 16", "a line with no mention row", null, null, false],
    ]);
  });
  it("never shows a dismissed mention's line or excerpt", () => {
    const steps = growthSteps(entries, [...mentions]);
    expect(steps.some((s) => s.note === "start small")).toBe(false);
  });
  it("pairs two mentions at the same instant one-to-one", () => {
    const same = parseTimeline([
      { date: "2026-10-08T14:35:40.000Z", line: "Oct 8: first" },
      { date: "2026-10-08T14:35:40.000Z", line: "Oct 8: second" },
    ]);
    const steps = growthSteps(same, [
      { id: 1, spokenAt: "2026-10-08T14:35:40.000Z", excerpt: "one", source: "ambient", reviewStatus: "accepted" },
      { id: 2, spokenAt: "2026-10-08T14:35:40.000Z", excerpt: "two", source: "ambient", reviewStatus: "accepted" },
    ]);
    expect(steps.map((s) => s.excerpt)).toEqual(["one", "two"]);
  });
});

describe("growthSteps with mentions that have no timeline line", () => {
  it("adds each unpaired, non-dismissed mention as a 'mentioned again' step, in date order", () => {
    const entries = parseTimeline([{ date: "2026-10-01T15:00:00.000Z", line: "Oct 1: first heard" }]);
    const steps = growthSteps(entries, [
      { id: 1, spokenAt: "2026-10-01T15:00:00.000Z", excerpt: "one", source: "ambient", reviewStatus: "accepted" },
      { id: 2, spokenAt: "2026-10-09T15:00:00.000Z", excerpt: "two", source: "voice", reviewStatus: "needs_review" },
      { id: 3, spokenAt: "2026-09-20T15:00:00.000Z", excerpt: null, source: "ambient", reviewStatus: "dismissed" },
    ]);
    expect(steps.map((s) => [s.dateLabel, s.note, s.excerpt, s.source, s.unconfirmed])).toEqual([
      ["Oct 1", "first heard", "one", "Bee conversation", false],
      ["Oct 9", "mentioned again", "two", "Voice note", true],
    ]);
  });
  it("keeps the step count equal to the non-dismissed mentions when every line has its mention", () => {
    const entries = parseTimeline([
      { date: "2026-10-01T15:00:00.000Z", line: "Oct 1: first heard" },
      { date: "2026-10-02T15:00:00.000Z", line: "Oct 2: added more" },
    ]);
    const mentions = [
      { id: 1, spokenAt: "2026-10-01T15:00:00.000Z", excerpt: "a", source: "ambient", reviewStatus: "accepted" },
      { id: 2, spokenAt: "2026-10-02T15:00:00.000Z", excerpt: "b", source: "ambient", reviewStatus: "accepted" },
      { id: 3, spokenAt: "2026-10-03T15:00:00.000Z", excerpt: "c", source: "ambient", reviewStatus: "accepted" },
    ];
    expect(growthSteps(entries, mentions)).toHaveLength(3);
  });
});
