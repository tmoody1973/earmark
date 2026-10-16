import { z } from "zod";
import type { RecType } from "../types";
import type { RecCardData } from "./queries";

/*
 * "New since last time": what Earmark caught after the owner's previous visit. One record, kept server-side
 * (sync_cursors, decision 023): the start of the visit before this one (`seenBefore`) and the last time the garden
 * rendered (`lastVisit`). Renders closer together than VISIT_GAP_MS are one visit, so a live refresh or a trip into an
 * idea and back does not empty the row he is still reading.
 */
export const VISIT_GAP_MS = 30 * 60_000;
export const NEW_ROW_MAX = 12;

const VisitSchema = z.object({ seenBefore: z.iso.datetime().nullable(), lastVisit: z.iso.datetime() });
export type VisitState = z.infer<typeof VisitSchema>;

export function parseVisit(raw: string | null): VisitState | null {
  if (!raw) return null;
  try {
    const r = VisitSchema.safeParse(JSON.parse(raw));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

/** The baseline for this render (`since`; null on the first visit ever) and the record to store after it. */
export function nextVisit(prev: VisitState | null, now: Date, gapMs = VISIT_GAP_MS): { since: string | null; next: VisitState } {
  const at = now.toISOString();
  if (!prev) return { since: null, next: { seenBefore: null, lastVisit: at } };
  const last = Date.parse(prev.lastVisit);
  if (now.getTime() - last > gapMs) return { since: prev.lastVisit, next: { seenBefore: prev.lastVisit, lastVisit: at } };
  return { since: prev.seenBefore, next: { seenBefore: prev.seenBefore, lastVisit: now.getTime() > last ? at : prev.lastVisit } };
}

export type NewChip =
  | { key: string; kind: "rec"; type: RecType; title: string; meta: string; at: string; href: string }
  | { key: string; kind: "bloom"; title: string; meta: string; at: string; href: string };

export interface BloomSince { clusterId: number; title: string; mentionCount: number; at: string }

const TYPE_WORD: Record<RecType, string> = {
  album: "album", song: "song", artist: "artist", book: "book", place: "place", podcast: "podcast", film_tv: "film / TV", other: "tip",
};

export const bloomMeta = (mentionCount: number) => `Bloomed · ${mentionCount} ${mentionCount === 1 ? "mention" : "mentions"}`;

export function bloomChip(b: BloomSince): NewChip {
  return { key: `idea-${b.clusterId}`, kind: "bloom", title: b.title, meta: bloomMeta(b.mentionCount), at: b.at, href: `/ideas/${b.clusterId}` };
}

function recChip(c: RecCardData): NewChip {
  const from = c.recommender ? `from ${c.recommender.firstName} · ` : "";
  return { key: `rec-${c.id}`, kind: "rec", type: c.type, title: c.name, meta: `${from}${TYPE_WORD[c.type]}`, at: c.createdAt, href: `/shelf#rec-${c.id}` };
}

/** Tips caught (and not yet acted on) and ideas bloomed after `since`, newest first, one chip per item. */
export function newSince(since: string | null, recs: readonly RecCardData[], blooms: readonly BloomSince[]): NewChip[] {
  const after = (t: string) => since === null || Date.parse(t) > Date.parse(since);
  const latestBloom = new Map<number, BloomSince>();
  for (const b of blooms) {
    const seen = latestBloom.get(b.clusterId);
    if (after(b.at) && (!seen || Date.parse(b.at) > Date.parse(seen.at))) latestBloom.set(b.clusterId, b);
  }
  const chips = [
    ...recs.filter((c) => (c.status === "new" || c.status === "needs_review") && after(c.createdAt)).map(recChip),
    ...[...latestBloom.values()].map(bloomChip),
  ];
  return chips.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, NEW_ROW_MAX);
}
