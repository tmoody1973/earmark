// The text of a tip's Bee todo (FR-17) and the open-todo cap (FR-20). Title, creator, who and when, and a link to the
// tip's card on the Shelf: never the excerpt or any transcript text (Bee shows todos on the phone and the wearable).
import type { RecRow } from "../store/rec-rows";
import type { RecType } from "../types";

export const TODO_PREFIX = "Earmark · ";
export const MAX_OPEN_TODOS = 10;
export const TODO_VERB: Record<RecType, string> = {
  album: "Listen", song: "Listen", artist: "Listen", podcast: "Listen",
  book: "Read", place: "Visit", film_tv: "Watch", video: "Watch", other: "Try",
};

const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" });

export const slotsAvailable = (open: number) => Math.max(0, MAX_OPEN_TODOS - open);

// An alarm for "now" reaches Bee a moment later, already past, and Bee never fires it (research todo, Oct 19: alarm
// 23:10:58.7, saved in Bee 23:10:59.4, no notification). One minute ahead is the smallest lead that always lands.
export const ALARM_LEAD_MS = 60_000;
export const alarmSoon = (now: Date = new Date()) => new Date(now.getTime() + ALARM_LEAD_MS).toISOString();

// A Bee todo's link opens the tip's own page (/tips/<id>, owner-only): art, preview, credits and what was said.
export const gardenLink = (baseUrl: string, recId: number) => `${baseUrl.replace(/\/$/, "")}/tips/${recId}`;

// A todo built outside the reconciler (place nudge, thank-you reminder, research ready) gets its page link too; no base
// URL, no link.
export function withLink(text: string, page: "tips" | "receipts" | "ideas", recId: number, base = process.env.EARMARK_PUBLIC_BASE_URL?.trim()): string {
  return base && Number.isInteger(recId) && recId > 0 ? `${text} ${base.replace(/\/$/, "")}/${page}/${recId}` : text;
}

export function formatTodoText(
  rec: Pick<RecRow, "id" | "type" | "canonical_name" | "creator" | "recommender_first_name" | "said_at">,
  baseUrl: string,
): string {
  const day = DAY.format(new Date(rec.said_at));
  const who = rec.recommender_first_name ? `${rec.recommender_first_name}, ${day}` : day;
  const what = rec.creator ? `${rec.canonical_name}, ${rec.creator}` : rec.canonical_name;
  return `${TODO_PREFIX}${TODO_VERB[rec.type]}: ${what} (${who}) ${gardenLink(baseUrl, rec.id)}`;
}
