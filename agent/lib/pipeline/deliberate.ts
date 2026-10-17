import { APICallError, RetryError } from "ai";
import { detectEarmarkTrigger } from "../bee/trigger";
import { ownerFirstName } from "../env";
import type { TriageResult, Utterance } from "../types";
import { chooseRecommender } from "./attribution";
import { clampExcerpt, wordCount } from "./excerpt";
import type { PipelineDeps } from "./process-conversation";
import type { SaveItem } from "./save-item";
import { TITLE_MAX_WORDS } from "./extract";
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

// Bee's diarization can cut the trigger word itself in two (real conversation 11338188: "Earm" | "ark that.", two
// speakers, same second). A short fragment is joined to the next utterance (with and without a space) when that next
// utterance does not trigger on its own and both were said together (both spoken_at known, ≤ 2 s apart). Joined, it
// behaves exactly like the same words said as one utterance. span = how many utterances the trigger used.
const MAX_FRAGMENT_WORDS = 3;
const MAX_FRAGMENT_GAP_MS = 2_000;
type Trigger = { t: ReturnType<typeof detectEarmarkTrigger>; text: string; span: 1 | 2 };
function triggerAt(us: readonly Utterance[], p: number): Trigger {
  const a = us[p]!.text.trim();
  const t = detectEarmarkTrigger(a);
  const next = us[p + 1];
  const b = next?.text.trim();
  const [ta, tb] = [us[p]!.spokenAt?.getTime(), next?.spokenAt?.getTime()];
  const together = ta !== undefined && tb !== undefined && Math.abs(tb - ta) <= MAX_FRAGMENT_GAP_MS;
  if (t.matched || !b || !together || wordCount(a) > MAX_FRAGMENT_WORDS || detectEarmarkTrigger(b).matched) return { t, text: a, span: 1 };
  for (const joined of [a + b, `${a} ${b}`]) {
    const j = detectEarmarkTrigger(joined);
    if (j.matched) return { t: j, text: joined, span: 2 };
  }
  return { t, text: a, span: 1 };
}

// Pulls the deliberate earmarks out of a transcript. rest is the transcript without them (and without their
// continuation), so ambient triage can never save the same thing a second time.
export function splitDeliberate(utterances: readonly Utterance[]): { earmarks: DeliberateEarmark[]; rest: Utterance[] } {
  const present = utterances.flatMap((x, index) => (x.text.trim() ? [{ x, index }] : []));
  const said = present.map(({ x }) => x);
  const trigger = present.map((_, p) => triggerAt(said, p));
  const taken = new Set<number>(); // original indexes removed from the transcript
  const earmarks: DeliberateEarmark[] = [];
  for (let p = 0; p < present.length; p++) {
    const { t, text, span } = trigger[p]!;
    if (!t.matched || taken.has(present[p]!.index)) continue;
    const { x, index } = present[p]!;
    taken.add(index);
    if (span === 2) taken.add(present[p + 1]!.index);
    const parts = t.body ? [t.body] : [];
    const alone = endsSentence(text) && wordCount(text) >= STANDALONE_WORDS && t.body;
    for (let n = span; !alone && n < span + CONTINUATION; n++) {
      const next = present[p + n];
      if (!next || trigger[p + n]!.t.matched) break;
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

// Errors that mean "the model service is down", not "this text defeated the extractor": retry later, don't degrade.
// The SDK's own guards, not names: SDK error names are prefixed ("AI_APICallError"). Our own classes and the platform's
// (Abort/Timeout/Gateway, fetch failures) have plain names. NoObjectGeneratedError / TypeValidationError are NOT outages.
export const isOutage = (err: unknown): boolean =>
  err instanceof SystemicTriageError || APICallError.isInstance(err) || RetryError.isInstance(err) ||
  (err instanceof Error && (/^(?:CompostUnavailableError|AbortError|FetchError)$|Gateway|Timeout/.test(err.name) ||
    (err instanceof TypeError && /fetch failed/i.test(err.message))));

// Voice notes and conversations both land here. An outage throws (the caller releases its claim and retries). Any other
// failure on this one item (bad model output, schema error) keeps what the person said: a raw rec, the spoken words as
// title and excerpt, nobody credited, in needs_review so it is seen rather than lost. Logs carry ids + err.name only.
export async function planDeliberateItem(body: string, ctx: DeliberateContext, d: PipelineDeps): Promise<SaveItem> {
  try {
    return await planDeliberateModel(body, ctx, d);
  } catch (err) {
    if (isOutage(err)) throw err;
    console.error(`[pipeline] earmark fell back to raw ${ctx.label} key=${ctx.deliberateKey ?? "-"} error=${err instanceof Error ? err.name : "unknown"}`);
    return {
      kind: "rec", route: "review", beeConversationId: ctx.beeConversationId, beeJournalId: ctx.beeJournalId, deliberateKey: ctx.deliberateKey ?? null,
      spokenAt: ctx.spokenAt, confidence: 1, source: "voice", recType: "other",
      extraction: { canonicalName: clampExcerpt(body, TITLE_MAX_WORDS), creator: null, recommenderName: null, excerpt: clampExcerpt(body) },
      attribution: { firstName: null, source: "none" },
    };
  }
}

async function planDeliberateModel(body: string, ctx: DeliberateContext, d: PipelineDeps): Promise<SaveItem> {
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
