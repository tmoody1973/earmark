import { z } from "zod";

export const GardenerScheduleSchema = z.discriminatedUnion("every", [
  z.object({ every: z.literal("week"), weekday: z.number().int().min(0).max(6), hourUtc: z.number().int().min(0).max(23) }),
  z.object({ every: z.literal("month"), day: z.number().int().min(1).max(28), hourUtc: z.number().int().min(0).max(23) }),
]);
export type GardenerSchedule = z.infer<typeof GardenerScheduleSchema>;

/** Today's slot if today matches and the hour has passed. ponytail: a slot missed for a whole day is skipped, not caught up. */
export function dueSlot(s: GardenerSchedule, now: Date): Date | null {
  const matches = s.every === "week" ? now.getUTCDay() === s.weekday : now.getUTCDate() === s.day;
  if (!matches) return null;
  const slot = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), s.hourUtc));
  return now >= slot ? slot : null;
}

export function isDue(s: GardenerSchedule, lastRunAt: Date | null, now: Date): boolean {
  const slot = dueSlot(s, now);
  return slot !== null && (lastRunAt === null || lastRunAt < slot);
}

export type LocalSchedule =
  | { every: "week"; weekday: number; hourLocal: number }
  | { every: "month"; day: number; hourLocal: number };

/**
 * Chicago wall-clock choice -> stored UTC schedule, using the offset in force at `now`.
 * ponytail: the hour drifts by one across DST changes (fine for drafts); a UTC day rollover moves the weekday/day with it.
 * Chicago is always 5-6h behind UTC, so the rollover is at most +1 day; the month form is offered days 1-27 so it stays <= 28.
 */
export function toUtcSchedule(l: LocalSchedule, now: Date): GardenerSchedule {
  const chicagoHour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", hourCycle: "h23" }).format(now));
  const total = l.hourLocal + ((now.getUTCHours() - chicagoHour + 24) % 24);
  const hourUtc = total % 24;
  const carry = total >= 24 ? 1 : 0;
  return l.every === "week"
    ? { every: "week", weekday: (l.weekday + carry) % 7, hourUtc }
    : { every: "month", day: Math.min(l.day + carry, 28), hourUtc };
}

export const RETRY_BACKOFF_MS = 3 * 3_600_000; // after a failed attempt, wait this long before the next
export const MAX_FAILURES = 3; // first attempt plus two retries per period, then give up until the next period

export interface AttemptState { lastRunAt: Date | null; lastAttemptAt: Date | null; failCount: number }

/** Due this period AND not already attempted too recently / too often. A running attempt blocks like a recent failure. */
export function canAttempt(s: GardenerSchedule, st: AttemptState, now: Date): boolean {
  const slot = dueSlot(s, now);
  if (!slot || (st.lastRunAt && st.lastRunAt >= slot)) return false;
  if (!st.lastAttemptAt || st.lastAttemptAt < slot) return true; // first attempt of this period
  return st.failCount < MAX_FAILURES && now.getTime() - st.lastAttemptAt.getTime() >= RETRY_BACKOFF_MS;
}
