import { describe, expect, it } from "vitest";
import { canAttempt, isDue, toUtcSchedule } from "../../../agent/lib/gardeners/schedule";

const weekly = { every: "week" as const, weekday: 0, hourUtc: 13 };
const monthly = { every: "month" as const, day: 1, hourUtc: 14 };

describe("isDue", () => {
  it("is due on the right weekday after the hour, once", () => {
    expect(isDue(weekly, null, new Date("2026-10-18T13:05:00Z"))).toBe(true); // Sunday
    expect(isDue(weekly, new Date("2026-10-18T13:01:00Z"), new Date("2026-10-18T14:00:00Z"))).toBe(false);
  });
  it("is not due before the hour or on other days", () => {
    expect(isDue(weekly, null, new Date("2026-10-18T12:59:00Z"))).toBe(false);
    expect(isDue(weekly, null, new Date("2026-10-19T13:30:00Z"))).toBe(false);
  });
  it("runs again the next week", () => {
    expect(isDue(weekly, new Date("2026-10-18T13:01:00Z"), new Date("2026-10-25T13:00:00Z"))).toBe(true);
  });
  it("handles monthly day schedules", () => {
    expect(isDue(monthly, new Date("2026-10-01T14:00:00Z"), new Date("2026-11-01T15:00:00Z"))).toBe(true);
    expect(isDue(monthly, null, new Date("2026-11-02T15:00:00Z"))).toBe(false);
  });
});

describe("toUtcSchedule (Chicago wall-clock to UTC)", () => {
  const cdt = new Date("2026-10-16T12:00:00Z"); // CDT, UTC-5
  const cst = new Date("2026-12-16T12:00:00Z"); // CST, UTC-6
  it("shifts the hour by the Chicago offset", () => {
    expect(toUtcSchedule({ every: "week", weekday: 5, hourLocal: 9 }, cdt)).toEqual({ every: "week", weekday: 5, hourUtc: 14 });
    expect(toUtcSchedule({ every: "week", weekday: 5, hourLocal: 9 }, cst)).toEqual({ every: "week", weekday: 5, hourUtc: 15 });
  });
  it("rolls the weekday forward when the UTC hour passes midnight", () => {
    expect(toUtcSchedule({ every: "week", weekday: 6, hourLocal: 22 }, cdt)).toEqual({ every: "week", weekday: 0, hourUtc: 3 });
  });
  it("rolls the month day forward and stays inside 1-28", () => {
    expect(toUtcSchedule({ every: "month", day: 27, hourLocal: 22 }, cdt)).toEqual({ every: "month", day: 28, hourUtc: 3 });
  });
});

describe("canAttempt (bounded retries)", () => {
  const fri = { every: "week" as const, weekday: 5, hourUtc: 14 };
  const at = (h: string) => new Date(`2026-10-23T${h}:00Z`);
  const st = (lastAttempt: string | null, failCount: number) => ({ lastRunAt: null, lastAttemptAt: lastAttempt ? at(lastAttempt) : null, failCount });
  it("tries once when due and never attempted", () => expect(canAttempt(fri, st(null, 0), at("14:05"))).toBe(true));
  it("does not retry on the next hourly tick after a failure", () => expect(canAttempt(fri, st("14:05", 1), at("15:05"))).toBe(false));
  it("retries after the 3 hour backoff", () => expect(canAttempt(fri, st("14:05", 1), at("17:05"))).toBe(true));
  it("stops after 3 failures in the period", () => expect(canAttempt(fri, st("17:05", 3), at("23:05"))).toBe(false));
  it("ignores a failure count from an earlier period", () => {
    const s = { lastRunAt: null, lastAttemptAt: new Date("2026-10-16T20:00:00Z"), failCount: 3 };
    expect(canAttempt(fri, s, at("14:05"))).toBe(true);
  });
  it("is false once the period has a successful run", () => {
    expect(canAttempt(fri, { lastRunAt: at("14:10"), lastAttemptAt: at("14:05"), failCount: 0 }, at("20:00"))).toBe(false);
  });
});
