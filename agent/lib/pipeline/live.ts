import type { BeeClient } from "../bee/client";
import { db } from "../db";
import { planIdeaClusters } from "../ideas/compost";
import { bufferUtterance, rememberConversationUuid } from "../store/conversations";
import { LIVE_WINDOW, claimUtterances, conversationIdForUuid, finishUtterancesQuery } from "../store/utterances";
import { resolveDeps, type PipelineDeps } from "./process-conversation";
import { buildSaveQueries, savedIds, type SaveItem, type SavedIds } from "./save-item";
import { windowRoute } from "./thresholds";
import { toWindows } from "./windows";

export interface LiveUtterance {
  conversationUuid: string; speaker: string; text: string; utteranceId: number | null; spokenAt?: Date | null;
}
export interface LiveResult { triaged: boolean; windows: number; ideas: number; saved?: SavedIds }

// The live path (M2-T6): ideas only (recs wait for the completed pass: a rec need not appear mid-sentence).
// Every utterance is buffered; models run only when claimUtterances hands over a full window (LIVE_WINDOW: 4
// utterances, non-overlapping), never per utterance. Found ideas (accepted and review-band, decision 004) go through the idea
// compost plan and are saved by buildSaveQueries in one transaction that also marks the claimed utterances done, so
// the save, its garden events and the claim's done commit together or not at all.
// A failure leaves the claim unfinished: its lease lets a later delivery retry; the completed pass catches up anyway.
export async function handleLiveUtterance(u: LiveUtterance, deps: Partial<PipelineDeps> = {}): Promise<LiveResult> {
  await bufferUtterance(u.conversationUuid, u.speaker, u.text, u.spokenAt ?? null);
  const claim = await claimUtterances(u.conversationUuid, LIVE_WINDOW);
  if (!claim) return { triaged: false, windows: 0, ideas: 0 };

  const d = resolveDeps(deps);
  const conversationId = await resolveConversationId(u.conversationUuid, u.utteranceId, d.bee);
  const windows = toWindows(
    claim.rows.map((r) => ({ text: r.text, speaker: r.speaker, spokenAt: r.spokenAt ?? r.receivedAt })),
    { conversationId, conversationUuid: u.conversationUuid },
    LIVE_WINDOW,
  );
  const items: SaveItem[] = [];
  // ponytail: sequential; a claim is one window except after a retry backlog.
  for (const w of windows) {
    const t = await d.triage(w.text);
    const route = t.kind === "idea_by_user" ? windowRoute(t) : null;
    if (!route) continue;
    const extraction = await d.extractIdea(w.text);
    items.push({
      kind: "idea", route, extraction, beeConversationId: conversationId, beeConversationUuid: u.conversationUuid, beeJournalId: null,
      spokenAt: w.startedAt ?? d.now(), confidence: t.kindProbability, source: "ambient",
    });
  }
  const planned = await planIdeaClusters(items, d.compost);
  const results = await db().transaction((txn) => [
    ...planned.flatMap((it) => buildSaveQueries(txn, it)),
    finishUtterancesQuery(txn, claim.claimed),
  ]);
  const ideas = planned.length;
  return { triaged: true, windows: windows.length, ideas, ...(ideas > 0 ? { saved: savedIds(planned, results) } : {}) };
}

// The stream names a conversation by uuid; REST (and the completed pass) by numeric id. The map is filled by
// new-conversation events; when that event was missed, the stream utterance's id (the same id REST gives the
// utterance) finds the still-capturing conversation that holds it, and the pair is remembered.
// null = unknown: the mention is saved with its uuid alone (see buildSaveQueries / hasMentionFromSameOccasion).
// ponytail: looks at the 5 newest conversations; Bee captures one at a time.
async function resolveConversationId(uuid: string, utteranceId: number | null, bee: BeeClient): Promise<number | null> {
  const known = await conversationIdForUuid(uuid);
  if (known !== null || utteranceId === null) return known;
  try {
    const { conversations } = await bee.listConversations({ limit: 5 });
    for (const c of conversations.filter((x) => x.state !== "COMPLETED")) {
      const { conversation } = await bee.getConversation(c.id);
      if (conversation.transcriptions.some((t) => t.utterances.some((x) => x.id === utteranceId))) {
        await rememberConversationUuid(uuid, c.id);
        return c.id;
      }
    }
  } catch (err) {
    // ids + error name only: messages can echo transcript text.
    console.error(`[live] conversation lookup failed uuid=${uuid} error=${err instanceof Error ? err.name : "unknown"}`);
  }
  return null;
}
