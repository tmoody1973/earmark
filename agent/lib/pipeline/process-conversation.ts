import { createBeeClient, toDate, type BeeClient } from "../bee/client";
import {
  conversationCountsQuery, isConversationProcessed, markConversationProcessed, releaseConversation,
} from "../store/conversations";
import { db } from "../db";
import { planIdeaClusters, type CompostDeps } from "../ideas/compost";
import { ownerFirstName } from "../env";
import { chooseRecommender } from "./attribution";
import { extractIdea, extractRecommendation } from "./extract";
import { buildSaveQueries, noneSaved, savedIds, type SaveItem, type SavedIds } from "./save-item";
import { mapLimit } from "./map-limit";
import { windowRoute } from "./thresholds";
import { SystemicTriageError, triageWindow } from "./triage";
import { toWindows } from "./windows";
import type { TranscriptWindow, TriageResult } from "../types";

export interface PipelineDeps {
  bee: BeeClient;
  triage: typeof triageWindow;
  extractRecommendation: typeof extractRecommendation;
  extractIdea: typeof extractIdea;
  now: () => Date;
  // Cluster-planning deps (embed, Jev, timeline note); tests inject fakes so they never reach the Gateway.
  compost?: Partial<CompostDeps>;
}

// saved: ids from the save transaction — M3's rec lane and M2's clustering hook on these.
export interface ConversationResult { skipped: boolean; ideas: number; recs: number; reviews: number; failed: number; incomplete: boolean; saved: SavedIds; reason?: "capturing" }

export function resolveDeps(deps: Partial<PipelineDeps>): PipelineDeps {
  return {
    bee: deps.bee ?? createBeeClient(),
    triage: deps.triage ?? triageWindow,
    extractRecommendation: deps.extractRecommendation ?? extractRecommendation,
    extractIdea: deps.extractIdea ?? extractIdea,
    now: deps.now ?? (() => new Date()),
    compost: deps.compost,
  };
}

// ponytail: fixed 4 in flight; raise it (or make it per-model) if Gateway rate limits allow.
const WINDOW_CONCURRENCY = 4;

const FREQUENCY_ONLY = /^\s*\d{2,3}(\.\d)?\s*(fm|mhz)?\s*$/i;

type Planned = { item: SaveItem; key: string; windowIndex: number };

type WindowOutcome = { planned: Planned | null; finite: boolean; failed: boolean; aborted?: boolean };

// Never rejects: a model failure on one window is logged (error name only: messages can echo transcript text) and counted.
async function runWindow(
  w: TranscriptWindow, index: number, id: number, summary: string | null, fallbackAt: Date, d: PipelineDeps, deadline?: number,
): Promise<WindowOutcome> {
  if (deadline !== undefined && d.now().getTime() > deadline) return { planned: null, finite: false, failed: false, aborted: true };
  let finite = false;
  try {
    const t = await d.triage(w.text);
    finite = Number.isFinite(t.kindProbability) && Number.isFinite(t.broadcastProbability);
    return { planned: await planWindow(t, w, index, summary, fallbackAt, d), finite, failed: false };
  } catch (err) {
    console.error(`[pipeline] window failed conversation=${id} window=${index} error=${err instanceof Error ? err.name : "unknown"}`);
    return { planned: null, finite, failed: true };
  }
}

function systemicReason(outcomes: WindowOutcome[]): SystemicTriageError["reason"] | null {
  if (outcomes.length === 0) return null; // an empty transcript is a real "nothing found"
  if (outcomes.every((o) => o.failed)) return "all_failed";
  if (!outcomes.some((o) => o.finite)) return "no_probabilities";
  return null;
}

async function planWindow(
  t: TriageResult, w: TranscriptWindow, index: number, summary: string | null, fallbackAt: Date, d: PipelineDeps,
): Promise<Planned | null> {
  const route = windowRoute(t); // ads/station IDs, jokes, the user's own recs and low confidence are dropped here
  if (!route) return null;
  const common = {
    route, beeConversationId: w.conversationId, beeJournalId: null, spokenAt: w.startedAt ?? fallbackAt,
    confidence: t.kindProbability, source: "ambient",
  } as const;
  if (t.kind === "rec_to_user") {
    const ex = await d.extractRecommendation({ text: w.text, summary });
    if (FREQUENCY_ONLY.test(ex.canonicalName)) return null; // a station frequency ("88.9") is never a recommendation
    const attribution = chooseRecommender({
      triggerName: null, windowName: ex.recommenderName, windowText: w.text, summaryName: ex.recommenderName, summaryText: summary, ownerFirstName: ownerFirstName(),
    });
    return {
      windowIndex: index, key: ex.canonicalName.toLowerCase(),
      item: { ...common, kind: "rec", recType: t.recType === "none" ? "other" : t.recType, extraction: ex, attribution },
    };
  }
  const extraction = await d.extractIdea(w.text);
  return { windowIndex: index, key: "", item: { ...common, kind: "idea", extraction } };
}

// Overlapping windows can find the same thing twice: one rec per name (the most confident sighting), and of two ideas
// from adjacent windows keep the surer one.
// ponytail: adjacency heuristic; M2's clustering is the real merge.
function dedupe(planned: Planned[]): Planned[] {
  const out: Planned[] = [];
  for (const p of planned) {
    if (p.item.kind === "rec") {
      const at = out.findIndex((q) => q.item.kind === "rec" && q.key === p.key);
      if (at === -1) out.push(p);
      else if (p.item.confidence > out[at]!.item.confidence) out[at] = p;
      continue;
    }
    const prev = out.at(-1);
    if (prev?.item.kind === "idea" && p.windowIndex === prev.windowIndex + 1) {
      if (p.item.confidence > prev.item.confidence) out[out.length - 1] = p;
      continue;
    }
    out.push(p);
  }
  return out;
}

// deadline: absolute epoch ms. Past it no new window starts; the run saves nothing, releases its claim and returns incomplete.
// ponytail: a conversation larger than one function budget never completes on serverless (no per-window progress is
// saved); run it locally with scripts/backfill-once.ts.
export async function processConversation(
  id: number, deps: Partial<PipelineDeps> & { deadline?: number } = {},
): Promise<ConversationResult> {
  const skipped: ConversationResult = { skipped: true, ideas: 0, recs: 0, reviews: 0, failed: 0, incomplete: false, saved: noneSaved() };
  if (await isConversationProcessed(id)) return skipped;
  const d = resolveDeps(deps);
  const { deadline } = deps;
  const { conversation } = await d.bee.getConversation(id);
  if (conversation.state !== "COMPLETED") return { ...skipped, reason: "capturing" }; // still capturing, so unclaimed; the backfill picks it up later

  // Claim before any work so concurrent runs cannot both save. Anything that fails after this releases the claim.
  if (!(await markConversationProcessed(id, { ideas: 0, recs: 0 }))) return skipped;
  try {
    const transcription = conversation.transcriptions.find((t) => !t.realtime) ?? conversation.transcriptions[0];
    const utterances = (transcription?.utterances ?? []).map((u) => ({ text: u.text, speaker: u.speaker, spokenAt: toDate(u.spoken_at) }));
    const windows = toWindows(utterances, { conversationId: id, conversationUuid: null });
    const summary = conversation.summary ?? conversation.short_summary ?? null;
    const fallbackAt = toDate(conversation.start_time) ?? d.now();

    // A 415-utterance conversation is ~200 windows: run them a few at a time so it fits a function's time limit.
    const outcomes = await mapLimit(windows, WINDOW_CONCURRENCY, (w, i) => runWindow(w, i, id, summary, fallbackAt, d, deadline));
    if (outcomes.some((o) => o.aborted)) {
      console.error(`[pipeline] deadline reached conversation=${id}; nothing saved, claim released`);
      await releaseConversation(id);
      return { ...skipped, skipped: false, incomplete: true };
    }
    const failed = outcomes.filter((o) => o.failed).length;
    // A few failed windows keep the claim; a model that failed everywhere (or never gave a probability) is an outage,
    // not "nothing found", so release the claim (catch below) and let the backfill retry.
    const systemic = systemicReason(outcomes);
    if (systemic) {
      console.error(`[pipeline] systemic failure conversation=${id} reason=${systemic}`);
      throw new SystemicTriageError(systemic);
    }
    const items = dedupe(outcomes.flatMap((o) => (o.planned ? [o.planned] : [])));
    // Idea compost: embedding + Jev cluster choice per accepted idea (the last model calls), before the transaction.
    const saveItems = await planIdeaClusters(items.map((p) => p.item), d.compost);
    const counts = { ideas: saveItems.filter((it) => it.kind === "idea").length, recs: saveItems.filter((it) => it.kind === "rec").length };
    // All model calls are done; one transaction saves every item, the counts and done, or nothing.
    const results = await db().transaction((txn) => [...saveItems.flatMap((it) => buildSaveQueries(txn, it)), conversationCountsQuery(txn, id, counts)]);
    return {
      skipped: false, ...counts, reviews: saveItems.filter((it) => it.route === "review").length, failed, incomplete: false,
      saved: savedIds(saveItems, results),
    };
  } catch (err) {
    try {
      await releaseConversation(id); // nothing was saved (transaction), so the backfill can retry cleanly
    } catch (releaseErr) {
      console.error(`[pipeline] release failed conversation=${id} error=${releaseErr instanceof Error ? releaseErr.name : "unknown"}`);
    }
    throw err;
  }
}
