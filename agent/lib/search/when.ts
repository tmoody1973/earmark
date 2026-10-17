// Date phrases for memory-cue search, parsed in code on the Chicago calendar (never by a model: the date rule).
const TZ = "America/Chicago";

export interface DateRange { since: Date; until: Date }

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const DAY_MS = 86_400_000;

function chicagoParts(d: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TZ, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23", weekday: "short",
    }).formatToParts(d).map((x) => [x.type, x.value]),
  );
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute, dow: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday) };
}

// ponytail: M5-T6 plans a shared Chicago helper; move this there (or to lib/time.ts) when a second caller appears.
/** The instant a Chicago wall-clock time ("2026-09-01T00:00") names. */
export function chicagoLocalToUtc(local: string): Date {
  const [y, m, d, h, min] = local.split(/[-T:]/).map(Number);
  const wall = Date.UTC(y, m - 1, d, h, min);
  const offsetAt = (t: number) => {
    const p = chicagoParts(new Date(t));
    return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - t;
  };
  const guess = wall - offsetAt(wall);
  return new Date(wall - offsetAt(guess)); // second pass: the offset can change between `wall` and the answer (DST)
}

const pad = (n: number) => String(n).padStart(2, "0");
/** Midnight in Chicago for a calendar date; month/day may overflow (Date.UTC normalizes them). */
function midnight(y: number, m: number, d: number): Date {
  const n = new Date(Date.UTC(y, m - 1, d));
  return chicagoLocalToUtc(`${n.getUTCFullYear()}-${pad(n.getUTCMonth() + 1)}-${pad(n.getUTCDate())}T00:00`);
}
const monthRange = (y: number, m: number): DateRange => ({ since: midnight(y, m, 1), until: midnight(y, m + 1, 1) });

/** "today", "last week", "in September", "2026-09", "last 10 days"… as a [since, until) range; null when not understood. */
export function parseWhen(phrase: string, now: Date = new Date()): DateRange | null {
  const s = phrase.trim().toLowerCase().replace(/\s+/g, " ").replace(/^(in|during|on) /, "");
  const t = chicagoParts(now);
  if (s === "today") return { since: midnight(t.y, t.m, t.d), until: midnight(t.y, t.m, t.d + 1) };
  if (s === "yesterday") return { since: midnight(t.y, t.m, t.d - 1), until: midnight(t.y, t.m, t.d) };
  const mondayOffset = (t.dow + 6) % 7; // weeks start Monday
  if (s === "this week") return { since: midnight(t.y, t.m, t.d - mondayOffset), until: midnight(t.y, t.m, t.d - mondayOffset + 7) };
  if (s === "last week") return { since: midnight(t.y, t.m, t.d - mondayOffset - 7), until: midnight(t.y, t.m, t.d - mondayOffset) };
  if (s === "this month") return monthRange(t.y, t.m);
  if (s === "last month") return monthRange(t.m === 1 ? t.y - 1 : t.y, t.m === 1 ? 12 : t.m - 1);
  const lastN = s.match(/^(?:last|past) (\d{1,3}) days?$/);
  if (lastN) return { since: new Date(now.getTime() - Number(lastN[1]) * DAY_MS), until: now };
  const ym = s.match(/^(\d{4})-(\d{2})$/);
  if (ym && +ym[2] >= 1 && +ym[2] <= 12) return monthRange(+ym[1], +ym[2]);
  const named = s.match(/^([a-z]+)(?: (\d{4}))?$/);
  if (named) {
    const idx = MONTHS.findIndex((m) => m === named[1] || m.slice(0, 3) === named[1]);
    if (idx >= 0) {
      const month = idx + 1;
      const year = named[2] ? +named[2] : month > t.m ? t.y - 1 : t.y; // the most recent such month
      return monthRange(year, month);
    }
  }
  return null;
}
