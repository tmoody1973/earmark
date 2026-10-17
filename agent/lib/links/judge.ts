import { askBooleans } from "../decide/ask-booleans";
import { timelineNote } from "../garden/timeline";
import { recEmbedText, type RecEmbedInput } from "../recs/embed-text";
import { FITS, RELATED, SAME_IDEA } from "./criteria";

/** An idea as Jev sees it: title, summary, and its timeline lines ("Oct 6: first heard"); dates are dropped. */
export interface IdeaText { title: string; summary: string | null; notes: readonly string[] }
export type RecText = RecEmbedInput;

const MAX_WORDS = 80; // Jev reads short state best (context rot, jaggedness #6)
const clip = (s: string) => s.split(/\s+/).filter(Boolean).slice(0, MAX_WORDS).join(" ");

export function ideaText(i: IdeaText): string {
  // no dates: Jev is not asked about time (jaggedness #4)
  const notes = i.notes.map(timelineNote).filter((n) => n.trim() !== "");
  return clip([i.title, i.summary, notes.length ? `Notes: ${notes.join("; ")}` : null].filter(Boolean).join(". "));
}

/** One Jev call: are these two ideas related, and are they the same idea? */
export async function judgeIdeaPair(a: IdeaText, b: IdeaText, ask = askBooleans): Promise<{ related: number; sameIdea: number }> {
  const r = await ask({ idea_a: ideaText(a), idea_b: ideaText(b) }, { related: RELATED, same_idea: SAME_IDEA });
  return { related: r.related, sameIdea: r.same_idea };
}

/** One Jev call: could this tip be material for this idea? */
export async function judgeRecFit(rec: RecText, idea: IdeaText, ask = askBooleans): Promise<{ fits: number }> {
  // a tip reads to Jev exactly as it was embedded: one recipe (recs/embed-text.ts)
  const r = await ask({ rec: recEmbedText(rec), idea: ideaText(idea) }, { fits: FITS });
  return { fits: r.fits };
}
