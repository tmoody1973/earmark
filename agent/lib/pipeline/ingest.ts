import { createBeeClient, toDate } from "../bee/client";
import { parseEarmarkTrigger } from "../bee/trigger";
import { conversationRef, isJournalComplete, type BeeEvent } from "../bee/events";
import { shapeOf } from "../bee/webhook";
import { draftBlooms } from "../ideas/one-pager";
import { pruneUtteranceBuffer, rememberConversationUuid } from "../store/conversations";
import { handleLiveUtterance } from "./live";
import { processConversation, type PipelineDeps } from "./process-conversation";
import { processJournal } from "./process-journal";

const PRUNE_EVERY_MS = 3_600_000;
let lastPruneAt = Number.NEGATIVE_INFINITY; // per process (per warm function instance)

// Cheap guard: at most one prune per hour per process, piggybacked on the utterance stream.
async function maybePrune(now: Date): Promise<void> {
  if (now.getTime() - lastPruneAt < PRUNE_EVERY_MS) return;
  lastPruneAt = now.getTime();
  await pruneUtteranceBuffer();
}

// M2-T7: a save that bloomed a cluster is drafted right here, after its transaction committed, still inside the
// request's after()/waitUntil (never in front of the HTTP response, never inside the claim transaction). draftBlooms
// claims each cluster first, so this kick and the bee-changes schedule tail never draft the same one twice; it logs
// and gives back the claim on failure, and the schedule tail retries.
async function draftIfBloomed(saved: { bloomedClusterIds: number[] } | undefined): Promise<void> {
  if (saved?.bloomedClusterIds.length) await draftBlooms({ clusterIds: saved.bloomedClusterIds });
}

// The stream sends no created_at, yet a voice note's recording time is its rec's said_at and what the ±60 s
// one-earmark-per-moment check compares (M2-T14). For an earmark note only (rare), ask REST; on any failure use now.
// Known cost of the fallback: the note is dated by its delivery, which can be minutes after it was said, so the ±60 s
// check can miss its conversation copy and both are saved (a duplicate, never a lost earmark). Non-earmark notes save
// nothing, so they keep now without a lookup.
async function journalCreatedAt(id: string, text: string, deps: Partial<PipelineDeps>): Promise<Date> {
  const now = (deps.now ?? (() => new Date()))();
  if (!parseEarmarkTrigger(text).matched) return now;
  try {
    return toDate((await (deps.bee ?? createBeeClient()).getJournal(id)).created_at) ?? now;
  } catch (err) {
    console.error(`[bee] journal ${id} created_at lookup failed error=${err instanceof Error ? err.name : "unknown"}`);
    return now;
  }
}

async function dispatch(evt: BeeEvent, deps: Partial<PipelineDeps>): Promise<void> {
  switch (evt.event) {
    case "new-utterance": {
      const { utterance, conversation_uuid } = evt.data;
      try {
        const r = await handleLiveUtterance(
          {
            conversationUuid: conversation_uuid, speaker: utterance.speaker, text: utterance.text,
            utteranceId: utterance.id ?? null, spokenAt: toDate(utterance.spoken_at),
          }, deps,
        );
        if (r.triaged) console.log(`[live] uuid=${conversation_uuid} windows=${r.windows} ideas=${r.ideas} blooms=${r.saved?.bloomedClusterIds.join(",") ?? "-"}`);
        await draftIfBloomed(r.saved);
      } finally {
        await maybePrune((deps.now ?? (() => new Date()))());
      }
      return;
    }
    case "new-conversation": {
      const ref = conversationRef(evt.data);
      if (!ref) {
        console.warn(`[bee] new-conversation without id+uuid shape=${shapeOf(evt.data)}`);
        return;
      }
      return rememberConversationUuid(ref.uuid, ref.id);
    }
    case "update-conversation-summary": {
      const r = await processConversation(evt.data.conversation_id, deps);
      console.log(`[bee] conversation ${evt.data.conversation_id}`, r);
      return draftIfBloomed(r.saved);
    }
    case "journal-created":
    case "journal-updated": {
      const j = evt.data.journal;
      if (!j.text?.trim() || !isJournalComplete(j.state)) return; // journal-text is partial and ignored
      const r = await processJournal({ id: j.id, text: j.text, createdAt: await journalCreatedAt(j.id, j.text, deps) }, deps);
      console.log(`[bee] journal ${j.id}`, r);
      return draftIfBloomed(r.saved);
    }
    default:
      console.log(`[bee] ignored ${evt.event}`);
  }
}

// Errors are caught per event and logged with the event type only (messages can echo transcript text).
export async function handleBeeEvent(evt: BeeEvent, deps: Partial<PipelineDeps> = {}): Promise<void> {
  try {
    await dispatch(evt, deps);
  } catch (err) {
    console.error(`[bee] ${evt.event} failed error=${err instanceof Error ? err.name : "unknown"}`);
  }
}
