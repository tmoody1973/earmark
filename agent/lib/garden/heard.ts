// "Heard nearby" (decision 052): overheard tips nobody recommended (status 'overheard', set at save in
// pipeline/save-item.ts). A quiet log: no badge, no count. Keep and Clear go through setTipVerdict (queries.ts).
import { db } from "../db";
import { TIMELINE_TZ } from "../ideas/timeline-format";
import type { RecType } from "../types";

export const HEARD_DAYS = 14;
export const HEARD_MAX = 50;

export interface HeardItem { id: number; type: RecType; name: string; heardAt: string; excerpt: string }

// The excerpt is the stored ≤25 words (clamped at save), shown as where the tip came from; raw_text never is.
export async function getHeardNearby(): Promise<HeardItem[]> {
  const rows = (await db()`
    select id, type, canonical_name, said_at, excerpt from recommendations
    where status = 'overheard' and said_at >= now() - ${HEARD_DAYS}::int * interval '1 day'
    order by said_at desc, id desc limit ${HEARD_MAX}`) as { id: number | string; type: RecType; canonical_name: string; said_at: Date | string; excerpt: string | null }[];
  return rows.map((r) => ({
    id: Number(r.id), type: r.type, name: r.canonical_name, heardAt: new Date(r.said_at).toISOString(), excerpt: r.excerpt ?? "",
  }));
}

const WHEN = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: TIMELINE_TZ });
export const heardWhen = (iso: string) => `Heard ${WHEN.format(new Date(iso))}`;

export type HeardChoice = "keep" | "clear";

// What the list's live region says after a tap. `result` null: the save failed.
export function heardMessage(choice: HeardChoice, name: string, result: { changed: boolean } | null): string {
  if (!result) return `Couldn't save that. ${name} is back in the list; try again.`;
  if (!result.changed) return `Already handled: ${name}`;
  return choice === "keep" ? `Kept: ${name}. It’s on your shelf.` : `Cleared: ${name}`;
}
