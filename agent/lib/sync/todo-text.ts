// The text of a tip's Bee todo (FR-17) and the open-todo cap (FR-20). Title, creator, who and when, and a link to the
// tip's card on the Shelf: never the excerpt or any transcript text (Bee shows todos on the phone and the wearable).
import type { RecRow } from "../store/rec-rows";
import type { RecType } from "../types";

export const TODO_PREFIX = "Earmark · ";
export const MAX_OPEN_TODOS = 10;
export const TODO_VERB: Record<RecType, string> = {
  album: "Listen", song: "Listen", artist: "Listen", podcast: "Listen",
  book: "Read", place: "Visit", film_tv: "Watch", other: "Try",
};

const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" });

export const slotsAvailable = (open: number) => Math.max(0, MAX_OPEN_TODOS - open);

// The Shelf shows the newest 60 tips plus the one named by ?rec= (getShelf), and RecCard's article id is `rec-<id>`,
// so the link always lands on the tip. ponytail: no per-tip page exists; add one and point this at it if one lands.
export const gardenLink = (baseUrl: string, recId: number) => `${baseUrl.replace(/\/$/, "")}/shelf?rec=${recId}#rec-${recId}`;

export function formatTodoText(
  rec: Pick<RecRow, "id" | "type" | "canonical_name" | "creator" | "recommender_first_name" | "said_at">,
  baseUrl: string,
): string {
  const day = DAY.format(new Date(rec.said_at));
  const who = rec.recommender_first_name ? `${rec.recommender_first_name}, ${day}` : day;
  const what = rec.creator ? `${rec.canonical_name}, ${rec.creator}` : rec.canonical_name;
  return `${TODO_PREFIX}${TODO_VERB[rec.type]}: ${what} (${who}) ${gardenLink(baseUrl, rec.id)}`;
}
