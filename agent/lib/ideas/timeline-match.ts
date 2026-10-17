// Which timeline line belongs to which mention (M4-T6). The save path stamps each line with its mention's id
// (mention_id); merge, undo and forget move or drop lines by that id, never by date or text, because two mentions can
// share a moment (a live and a completed pass of one conversation) and two lines can share their words.
// Lines written before mention_id existed carry only the mention's spoken_at as their date. For those, the date
// decides only when exactly one line in the idea has that moment; otherwise the caller refuses rather than guess.

export interface StampedEntry { date: string; line: string; mention_id?: number }

export class TimelineAmbiguousError extends Error {
  override name = "TimelineAmbiguousError";
  constructor(clusterId: number) {
    super(`idea ${clusterId}: two timeline lines share this moment; can't tell which is this mention`);
  }
}

/** The index of this mention's line in `timeline`, or -1 when it has none. Throws TimelineAmbiguousError. */
export function lineIndexFor(
  timeline: readonly StampedEntry[],
  m: { id: number; spokenAt: Date | string },
  clusterId: number,
): number {
  const byId = timeline.findIndex((e) => e.mention_id != null && Number(e.mention_id) === m.id);
  if (byId !== -1) return byId;
  const at = new Date(m.spokenAt).getTime();
  const same = timeline.flatMap((e, i) => (Date.parse(e.date) === at ? [i] : []));
  if (same.every((i) => timeline[i]!.mention_id != null)) return -1; // nothing at that moment, or only other mentions' lines
  if (same.length === 1) return same[0]!;
  throw new TimelineAmbiguousError(clusterId);
}
