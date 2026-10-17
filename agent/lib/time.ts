// Shared Chicago-time helpers (the owner lives in Milwaukee; weeks and days follow Central time).
const TZ = "America/Chicago";

// The Chicago calendar date (YYYY-MM-DD) of an instant.
export function chicagoDate(now: Date): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(now).map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}`;
}

// The Chicago Sunday on or before `now`, as YYYY-MM-DD.
export function weekOfSunday(now: Date): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "numeric", day: "numeric", weekday: "short" })
      .formatToParts(now).map((x) => [x.type, x.value]),
  );
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day - dow)).toISOString().slice(0, 10);
}

/** The Chicago wall-clock parts of an instant (dow: 0 = Sunday). */
export function chicagoParts(d: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TZ, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23", weekday: "short",
    }).formatToParts(d).map((x) => [x.type, x.value]),
  );
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute, dow: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday) };
}

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
