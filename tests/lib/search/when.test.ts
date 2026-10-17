import { describe, expect, it } from "vitest";
import { parseWhen } from "../../../agent/lib/search/when";

const now = new Date("2026-10-18T17:00:00Z"); // Sun Oct 18, noon in Chicago
const iso = (r: { since: Date; until: Date } | null) => r && [r.since.toISOString(), r.until.toISOString()];

describe("parseWhen (Chicago calendar)", () => {
  it("today and yesterday", () => {
    expect(iso(parseWhen("today", now))).toEqual(["2026-10-18T05:00:00.000Z", "2026-10-19T05:00:00.000Z"]);
    expect(iso(parseWhen("yesterday", now))).toEqual(["2026-10-17T05:00:00.000Z", "2026-10-18T05:00:00.000Z"]);
  });
  it("uses the Chicago date, not the UTC date, late in the evening", () => {
    const lateEvening = new Date("2026-10-19T03:00:00Z"); // Sun Oct 18, 10 pm in Chicago
    expect(iso(parseWhen("today", lateEvening))?.[0]).toBe("2026-10-18T05:00:00.000Z");
  });
  it("month names resolve to the most recent such month", () => {
    expect(iso(parseWhen("in September", now))).toEqual(["2026-09-01T05:00:00.000Z", "2026-10-01T05:00:00.000Z"]);
    expect(iso(parseWhen("november", now))).toEqual(["2025-11-01T05:00:00.000Z", "2025-12-01T06:00:00.000Z"]);
    expect(iso(parseWhen("Sep", now))?.[0]).toBe("2026-09-01T05:00:00.000Z");
    expect(iso(parseWhen("September 2025", now))?.[0]).toBe("2025-09-01T05:00:00.000Z");
    expect(iso(parseWhen("2026-09", now))?.[0]).toBe("2026-09-01T05:00:00.000Z");
    expect(iso(parseWhen("december", new Date("2027-01-10T18:00:00Z")))?.[0]).toBe("2026-12-01T06:00:00.000Z");
  });
  it("relative phrases", () => {
    expect(iso(parseWhen("this month", now))).toEqual(["2026-10-01T05:00:00.000Z", "2026-11-01T05:00:00.000Z"]);
    expect(iso(parseWhen("last month", now))?.[0]).toBe("2026-09-01T05:00:00.000Z");
    expect(iso(parseWhen("last month", new Date("2026-01-15T18:00:00Z")))?.[0]).toBe("2025-12-01T06:00:00.000Z");
    expect(iso(parseWhen("last 10 days", now))?.[0]).toBe("2026-10-08T17:00:00.000Z");
    expect(iso(parseWhen("this week", now))?.[0]).toBe("2026-10-12T05:00:00.000Z"); // weeks start Monday
    expect(iso(parseWhen("last week", now))).toEqual(["2026-10-05T05:00:00.000Z", "2026-10-12T05:00:00.000Z"]);
  });
  it("accepts \"sept\" as September", () => {
    expect(iso(parseWhen("in sept", now))).toEqual(["2026-09-01T05:00:00.000Z", "2026-10-01T05:00:00.000Z"]);
  });
  it("returns null for phrases it does not understand", () => {
    expect(parseWhen("when we were at dinner", now)).toBeNull();
    expect(parseWhen("2026-13", now)).toBeNull();
    expect(parseWhen("", now)).toBeNull();
  });
});
