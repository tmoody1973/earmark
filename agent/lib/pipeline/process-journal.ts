import { parseEarmarkTrigger } from "../bee/trigger";
import { db } from "../db";
import { planIdeaClusters } from "../ideas/compost";
import { journalItemQuery, markJournalProcessed, releaseJournal } from "../store/conversations";
import { planDeliberateItem } from "./deliberate";
import { resolveDeps, type PipelineDeps } from "./process-conversation";
import { buildSaveQueries, noneSaved, savedIds, type SavedIds } from "./save-item";

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
    const planned = await planDeliberateItem(
      trigger.body, { label: `journal=${j.id}`, beeConversationId: null, beeJournalId: j.id, spokenAt: j.createdAt }, d,
    );
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
