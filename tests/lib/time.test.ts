import { describe, expect, it } from "vitest";
import { chicagoDate, chicagoLocalToUtc, weekOfSunday } from "../../agent/lib/time";

it("weekOfSunday returns the Chicago Sunday on or before now", () => {
  expect(weekOfSunday(new Date("2026-10-18T17:00:00Z"))).toBe("2026-10-18");
  expect(weekOfSunday(new Date("2026-10-21T17:00:00Z"))).toBe("2026-10-18");
  expect(weekOfSunday(new Date("2026-10-18T03:00:00Z"))).toBe("2026-10-11"); // still Saturday night in Chicago
});
it("chicagoDate uses the Chicago calendar day", () => {
  expect(chicagoDate(new Date("2026-10-18T03:00:00Z"))).toBe("2026-10-17");
});
describe("chicagoLocalToUtc", () => {
  it("applies daylight and standard time", () => {
    expect(chicagoLocalToUtc("2026-07-04T00:00").toISOString()).toBe("2026-07-04T05:00:00.000Z");
    expect(chicagoLocalToUtc("2026-12-25T09:30").toISOString()).toBe("2026-12-25T15:30:00.000Z");
  });
  it("is right on both days the clocks change", () => {
    expect(chicagoLocalToUtc("2026-03-08T00:00").toISOString()).toBe("2026-03-08T06:00:00.000Z");
    expect(chicagoLocalToUtc("2026-03-09T00:00").toISOString()).toBe("2026-03-09T05:00:00.000Z");
    expect(chicagoLocalToUtc("2026-11-01T00:00").toISOString()).toBe("2026-11-01T05:00:00.000Z");
    expect(chicagoLocalToUtc("2026-11-02T00:00").toISOString()).toBe("2026-11-02T06:00:00.000Z");
  });
});

