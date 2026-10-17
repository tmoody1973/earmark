import { expect, it } from "vitest";
import { chicagoDate, weekOfSunday } from "../../agent/lib/time";

it("weekOfSunday returns the Chicago Sunday on or before now", () => {
  expect(weekOfSunday(new Date("2026-10-18T17:00:00Z"))).toBe("2026-10-18");
  expect(weekOfSunday(new Date("2026-10-21T17:00:00Z"))).toBe("2026-10-18");
  expect(weekOfSunday(new Date("2026-10-18T03:00:00Z"))).toBe("2026-10-11"); // still Saturday night in Chicago
});
it("chicagoDate uses the Chicago calendar day", () => {
  expect(chicagoDate(new Date("2026-10-18T03:00:00Z"))).toBe("2026-10-17");
});
