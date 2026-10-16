import { parseEarmarkTrigger } from "../bee/trigger";
import { db } from "../db";
import { planIdeaClusters } from "../ideas/compost";
import { ownerFirstName } from "../env";
import { journalItemQuery, markJournalProcessed, releaseJournal } from "../store/conversations";
import { chooseRecommender } from "./attribution";
import { resolveDeps, type PipelineDeps } from "./process-conversation";
import { buildSaveQueries, noneSaved, savedIds, type SaveItem, type SavedIds } from "./save-item";
import { SystemicTriageError } from "./triage";
import type { TriageResult } from "../types";

// A spoken "Earmark that" is an explicit request: the item is always kept (confidence 1, no thresholds).
// Jev only decides idea vs rec (and rec type); anything not clearly an idea is filed as a rec.
// The note's single triage call failing (or giving no probability) is an outage, not an answer: release and retry later.
async function triageVoice(id: string, body: string, d: PipelineDeps): Promise<TriageResult> {
  const systemic = (reason: SystemicTriageError["reason"], cause?: unknown) => {
    console.error(`[pipeline] systemic failure journal=${id} reason=${reason}`);
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

async function planVoiceItem(j: { id: string; createdAt: Date }, body: string, d: PipelineDeps): Promise<SaveItem> {
  const t = await triageVoice(j.id, body, d);
  const common = { route: "accept", beeConversationId: null, beeJournalId: j.id, spokenAt: j.createdAt, confidence: 1, source: "voice" } as const;
  if (t.kind === "idea_by_user") return { ...common, kind: "idea", extraction: await d.extractIdea(body) };
  const extraction = await d.extractRecommendation({ text: body, summary: null });
  // Only a name that really appears in the spoken note is credited; otherwise null + 'none'.
  const attribution = chooseRecommender({
    triggerName: extraction.recommenderName, windowName: null, windowText: body, summaryName: null, summaryText: null, ownerFirstName: ownerFirstName(),
  });
  return { ...common, kind: "rec", recType: t.recType === "none" ? "other" : t.recType, extraction, attribution };
}

// saved: ids from the save transaction — M3's rec lane and M2's clustering hook on these.
export interface JournalResult { created: "idea" | "rec" | null; saved: SavedIds }

export async function processJournal(
  j: { id: string; text: string; createdAt: Date }, deps: Partial<PipelineDeps> = {},
): Promise<JournalResult> {
  const nothing: JournalResult = { created: null, saved: noneSaved() };
  if (!j.text.trim()) return nothing; // nothing transcribed yet: do not claim, a later delivery may have text
  const trigger = parseEarmarkTrigger(j.text);
  // Not an "Earmark that" note: record it as finished ('none', done) so no delivery or backfill looks again.
  if (!trigger.matched) {
    await markJournalProcessed(j.id, { type: "none", id: null }, true);
    return nothing;
  }
  // Claim first so created+updated deliveries and the backfill cannot both create an item.
  if (!(await markJournalProcessed(j.id, { type: "none", id: null }))) return nothing;
  try {
    const d = resolveDeps(deps);
    const planned = await planVoiceItem(j, trigger.body, d);
    // Ideas join the compost (embedding + Jev cluster choice). Dropped only if this very note already has a mention
    // on the chosen cluster; the claim still finishes (its item is that existing mention's cluster).
    const [item] = await planIdeaClusters([planned], d.compost);
    // The item and the claim's item_type/item_id commit together, or nothing does.
    const results = await db().transaction((txn) => [...(item ? buildSaveQueries(txn, item) : []), journalItemQuery(txn, j.id, planned.kind)]);
    return item ? { created: item.kind, saved: savedIds([item], results) } : nothing;
  } catch (err) {
    try {
      await releaseJournal(j.id);
    } catch (releaseErr) {
      console.error(`[pipeline] release failed journal=${j.id} error=${releaseErr instanceof Error ? releaseErr.name : "unknown"}`);
    }
    throw err;
  }
}
