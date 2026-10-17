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
