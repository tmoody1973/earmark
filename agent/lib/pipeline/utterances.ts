import { toDate } from "../bee/client";
import type { Utterance } from "../types";

// spoken_at when both have it; otherwise Bee's id (increasing in time); otherwise 0 so the stable sort keeps array order.
// ponytail: not a total order when some utterances lack spoken_at and others don't; REST has always sent it so far.
export function spokenOrder(a: { spokenAt: Date | null; id: number | null }, b: { spokenAt: Date | null; id: number | null }): number {
  if (a.spokenAt && b.spokenAt) return a.spokenAt.getTime() - b.spokenAt.getTime() || (a.id ?? 0) - (b.id ?? 0);
  return a.id !== null && b.id !== null ? a.id - b.id : 0;
}

type RawUtterance = { text: string; speaker: string; spoken_at?: number | string | null; id?: number };
type RawConversation = { transcriptions: { realtime: boolean; utterances: RawUtterance[] }[] };

// The final (non-realtime) transcription's utterances in spoken order. Bee's REST array is not in spoken order
// (11338188: 108 of 311 neighbours swapped), so a window is always the utterances actually said next.
export function utterancesOf(conversation: RawConversation): (Utterance & { id: number | null })[] {
  const transcription = conversation.transcriptions.find((t) => !t.realtime) ?? conversation.transcriptions[0];
  return (transcription?.utterances ?? [])
    .map((u) => ({ text: u.text, speaker: u.speaker, spokenAt: toDate(u.spoken_at), id: u.id ?? null }))
    .sort(spokenOrder);
}
