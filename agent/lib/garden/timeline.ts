import { formatTimelineDate, NOTE_AGAIN, type TimelineEntry } from "../ideas/timeline-format";
import type { IdeaStage, Source } from "../types";
import { stageLabel } from "./plant";

export type { TimelineEntry };

// M2-T5 writes {date: ISO, line: "Oct 6: note"} in PROCESSING order; readers sort by date. Array.sort is stable, so
// two mentions at the same instant keep the order they were saved in.
export function parseTimeline(raw: unknown): TimelineEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e): e is TimelineEntry =>
      typeof e?.date === "string" && typeof e?.line === "string" && e.line.trim() !== "" && !Number.isNaN(Date.parse(e.date)))
    .map((e) => ({ date: new Date(e.date).toISOString(), line: e.line }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// The stored line starts with the date code wrote ("Oct 6: "); the page sets that date on its own, so drop it here.
const DATE_PREFIX = /^[A-Z][a-z]{2} \d{1,2}: /;
export function timelineNote(line: string): string {
  return line.replace(DATE_PREFIX, "");
}

export function heardLine(i: { stage: IdeaStage; mentionCount: number; first: string | null; last: string | null }): string {
  const parts = [stageLabel(i.stage), `${i.mentionCount} ${i.mentionCount === 1 ? "mention" : "mentions"}`];
  const first = i.first ? formatTimelineDate(new Date(i.first)) : null;
  const last = i.last ? formatTimelineDate(new Date(i.last)) : null;
  if (first && last && first !== last) parts.push(`first heard ${first}`, `last ${last}`);
  else if (first ?? last) parts.push(`heard ${first ?? last}`);
  return parts.join(" · ");
}

const SOURCE_LABEL: Record<Source, string> = {
  ambient: "Bee conversation",
  voice: "Voice note",
  photo: "Photo",
  song: "Song",
  email: "Email",
};

export interface MentionRef {
  id: number;
  spokenAt: string;
  /** null for a dismissed mention: the query never selects a dismissed excerpt. */
  excerpt: string | null;
  source: string;
  reviewStatus: string;
}

export interface GrowthStep {
  key: string;
  date: string;
  dateLabel: string;
  note: string;
  source: string | null;
  excerpt: string | null;
  unconfirmed: boolean;
}

// One step per timeline line, oldest first. Each line was written for one mention at that mention's own time
// (timelineEntryJson), so lines pair with mentions by time, one-to-one. A line whose mention was dismissed is dropped
// with its excerpt; a line with no mention row (older data) still shows, without an excerpt. A non-dismissed mention
// with no line of its own still gets a step ("mentioned again"), so the steps never undercount the mentions.
export function growthSteps(entries: readonly TimelineEntry[], mentions: readonly MentionRef[]): GrowthStep[] {
  const unused = [...mentions];
  const step = (date: string, note: string, m: MentionRef | null, key: string): GrowthStep => ({
    key,
    date,
    dateLabel: formatTimelineDate(new Date(date)),
    note,
    source: m ? (SOURCE_LABEL[m.source as Source] ?? null) : null,
    excerpt: m?.excerpt ?? null,
    unconfirmed: m?.reviewStatus === "needs_review",
  });
  const fromLines = entries.flatMap((e, i) => {
    const at = unused.findIndex((m) => Date.parse(m.spokenAt) === Date.parse(e.date));
    const m = at === -1 ? null : unused.splice(at, 1)[0]!;
    return m?.reviewStatus === "dismissed" ? [] : [step(e.date, timelineNote(e.line), m, `${e.date}-${i}`)];
  });
  const unpaired = unused
    .filter((m) => m.reviewStatus !== "dismissed")
    .map((m) => step(new Date(m.spokenAt).toISOString(), NOTE_AGAIN, m, `mention-${m.id}`));
  return [...fromLines, ...unpaired].sort((a, b) => a.date.localeCompare(b.date));
}

/** The newest line by date, skipping lines written for mentions that were later dismissed (one skip per dismissal). */
export function latestLine(entries: readonly TimelineEntry[], dismissedAt: readonly string[]): string | null {
  const dismissed = dismissedAt.map((d) => Date.parse(d));
  const kept = entries.filter((e) => {
    const at = dismissed.indexOf(Date.parse(e.date));
    if (at === -1) return true;
    dismissed.splice(at, 1);
    return false;
  });
  return kept.at(-1)?.line ?? null;
}
