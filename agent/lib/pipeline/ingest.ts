import { toDate } from "../bee/client";
import { isJournalComplete, type BeeEvent } from "../bee/events";
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
      } finally {
        await maybePrune((deps.now ?? (() => new Date()))());
      }
      return;
    }
    case "new-conversation":
      return rememberConversationUuid(evt.data.conversation.uuid, evt.data.conversation.id);
    case "update-conversation-summary": {
      const r = await processConversation(evt.data.conversation_id, deps);
      console.log(`[bee] conversation ${evt.data.conversation_id}`, r);
      return;
    }
    case "journal-created":
    case "journal-updated": {
      const j = evt.data.journal;
      if (!j.text?.trim() || !isJournalComplete(j.state)) return; // journal-text is partial and ignored
      const r = await processJournal({ id: j.id, text: j.text, createdAt: (deps.now ?? (() => new Date()))() }, deps);
      console.log(`[bee] journal ${j.id}`, r);
      return;
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
