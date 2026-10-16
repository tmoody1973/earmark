// The timeline's pure pieces, with no imports, so the garden pages can format dates without loading `ai` or env.
// timeline.ts re-exports these; the writer side (writeTimelineNote) stays there.

export const TIMELINE_TZ = "America/Chicago";
export const NOTE_FIRST = "first heard";
export const NOTE_AGAIN = "mentioned again";

export interface TimelineEntry { date: string; line: string }

export function formatTimelineDate(d: Date, timeZone = TIMELINE_TZ): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone }).format(d);
}
