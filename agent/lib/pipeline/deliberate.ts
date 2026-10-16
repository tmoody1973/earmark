import { detectEarmarkTrigger } from "../bee/trigger";
import { ownerFirstName } from "../env";
import type { TriageResult, Utterance } from "../types";
import { chooseRecommender } from "./attribution";
import { wordCount } from "./excerpt";
import type { PipelineDeps } from "./process-conversation";
import type { SaveItem } from "./save-item";
import { SystemicTriageError } from "./triage";

// A deliberate "Earmark that" said inside a conversation: the triggered utterance plus, when it does not end the
// item by itself, up to CONTINUATION following utterances (M2-T12, decision 007).
export interface DeliberateEarmark {
  // Identity within the conversation: the triggered utterance's Bee id ("u123"), else its position ("i4").
  // Stored on the saved item so re-processing the conversation can never save it twice.
  key: string;
  body: string;
  spokenAt: Date | null;
}

const CONTINUATION = 2;
const STANDALONE_WORDS = 6;

const endsSentence = (t: string) => /[.!?…]["'”’)]*\s*$/.test(t.trim());

// Pulls the deliberate earmarks out of a transcript. rest is the transcript without them (and without their
// continuation), so ambient triage can never save the same thing a second time.
export function splitDeliberate(utterances: readonly Utterance[]): { earmarks: DeliberateEarmark[]; rest: Utterance[] } {
  const present = utterances.flatMap((x, index) => (x.text.trim() ? [{ x, index }] : []));
  const trigger = present.map(({ x }) => detectEarmarkTrigger(x.text));
  const taken = new Set<number>(); // original indexes removed from the transcript
  const earmarks: DeliberateEarmark[] = [];
  for (let p = 0; p < present.length; p++) {
    const t = trigger[p]!;
    if (!t.matched) continue;
    const { x, index } = present[p]!;
    taken.add(index);
    const parts = t.body ? [t.body] : [];
    const alone = endsSentence(x.text) && wordCount(x.text) >= STANDALONE_WORDS && t.body;
    for (let n = 1; !alone && n <= CONTINUATION; n++) {
      const next = present[p + n];
      if (!next || trigger[p + n]!.matched) break;
      parts.push(next.x.text.trim().replace(/\s+/g, " "));
      taken.add(next.index);
    }
    if (parts.length) earmarks.push({ key: x.id != null ? `u${x.id}` : `i${index}`, body: parts.join(" "), spokenAt: x.spokenAt });
  }
  return { earmarks, rest: utterances.filter((_, i) => !taken.has(i)) };
}

// A spoken "Earmark that" is an explicit request: the item is always kept (route accept, confidence 1, no thresholds,
// review status accepted / new, source 'voice'). Jev only decides idea vs rec (and rec type); anything not clearly an
// idea is filed as a rec. The ONE planner for voice notes and for earmarks said inside a conversation.
// A triage call failing (or giving no probability) is an outage, not an answer: it throws so the caller releases its
// claim and retries later.
async function triageDeliberate(label: string, body: string, d: PipelineDeps): Promise<TriageResult> {
  const systemic = (reason: SystemicTriageError["reason"], cause?: unknown) => {
    console.error(`[pipeline] systemic failure ${label} reason=${reason}`);
    return new SystemicTriageError(reason, { cause });
  };
  let t: TriageResult;
  try {
    t = await d.triage(`Unknown: ${body}`); // same one-line shape Jev sees for ambient windows
  } catch (err) {
    throw systemic("all_failed", err);
  }
  if (!Number.isFinite(t.kindProbability)) throw systemic("no_probabilities");
  return t;
}

export interface DeliberateContext {
  label: string; // log label, ids only: "journal=…" / "conversation=…"
  beeConversationId: number | null;
  beeJournalId: string | null;
  spokenAt: Date;
  deliberateKey?: string | null;
}

export async function planDeliberateItem(body: string, ctx: DeliberateContext, d: PipelineDeps): Promise<SaveItem> {
  const t = await triageDeliberate(ctx.label, body, d);
  const common = {
    route: "accept", beeConversationId: ctx.beeConversationId, beeJournalId: ctx.beeJournalId, deliberateKey: ctx.deliberateKey ?? null,
    spokenAt: ctx.spokenAt, confidence: 1, source: "voice",
  } as const;
  if (t.kind === "idea_by_user") return { ...common, kind: "idea", extraction: await d.extractIdea(body) };
  const extraction = await d.extractRecommendation({ text: body, summary: null });
  // Only a name that really appears in the spoken text is credited (and never the owner); otherwise null + 'none'.
  const attribution = chooseRecommender({
    triggerName: extraction.recommenderName, windowName: null, windowText: body, summaryName: null, summaryText: null, ownerFirstName: ownerFirstName(),
  });
  return { ...common, kind: "rec", recType: t.recType === "none" ? "other" : t.recType, extraction, attribution };
}
