import type { NeonQueryFunctionInTransaction } from "@neondatabase/serverless";
import { db } from "../db";

export type Txn = NeonQueryFunctionInTransaction<false, false>;

// Claim lease: a claim is "in progress" until its saves commit with done = true. An unfinished claim older than
// this (the run crashed or hit its time limit) may be re-taken; a done claim never can.
// INVARIANT: the lease must stay strictly longer than the longest function duration that can process one conversation
// (it assumes the nightly schedule's Vercel "max" duration is under 15 minutes). If a run could outlive it, a newer
// runner may re-take the claim while the old run is still saving.
// ponytail: fixed 15 min lease; make it per-caller if runs ever get longer.
export const CLAIM_LEASE = "15 minutes";

// spokenAt: the stream's own spoken_at, when it sent one.
export async function bufferUtterance(uuid: string, speaker: string, text: string, spokenAt: Date | null = null): Promise<void> {
  await db()`insert into utterance_buffer (conversation_uuid, speaker, text, spoken_at) values (${uuid}, ${speaker}, ${text}, ${spokenAt})`;
}

// Live utterances are kept only briefly, for in-conversation detection (M2-T6), then deleted (README privacy promise):
// after 6 hours, or as soon as their conversation's completed pass is done (it re-reads the transcript from Bee).
export async function pruneUtteranceBuffer(): Promise<void> {
  await db()`delete from utterance_buffer b
             where b.received_at < now() - interval '6 hours'
                or exists (select 1 from bee_conversation_map m
                           join processed_conversations p on p.bee_conversation_id = m.bee_conversation_id
                           where m.conversation_uuid = b.conversation_uuid and p.done)`;
}

export async function rememberConversationUuid(uuid: string, id: number): Promise<void> {
  await db()`insert into bee_conversation_map (conversation_uuid, bee_conversation_id)
             values (${uuid}, ${id}) on conflict do nothing`;
}

// Processed = finished, or claimed recently enough that its run may still be going.
export async function isConversationProcessed(id: number): Promise<boolean> {
  const rows = await db()`select 1 from processed_conversations
                          where bee_conversation_id = ${id}
                            and (done or processed_at >= now() - ${CLAIM_LEASE}::interval)`;
  return rows.length > 0;
}

// Claim: true only for the first caller (or whoever re-takes a stale unfinished claim), so concurrent runs cannot double-insert.
export async function markConversationProcessed(id: number, counts: { ideas: number; recs: number }): Promise<boolean> {
  const rows = await db()`insert into processed_conversations (bee_conversation_id, idea_count, rec_count)
                          values (${id}, ${counts.ideas}, ${counts.recs})
                          on conflict (bee_conversation_id) do update
                            set processed_at = now(), idea_count = excluded.idea_count, rec_count = excluded.rec_count
                            where processed_conversations.done = false
                              and processed_conversations.processed_at < now() - ${CLAIM_LEASE}::interval
                          returning bee_conversation_id`;
  return rows.length === 1;
}

// Query builder: runs inside the same transaction as the item inserts, so counts, items and done commit together.
export function conversationCountsQuery(txn: Txn, id: number, counts: { ideas: number; recs: number }) {
  return txn`update processed_conversations set idea_count = ${counts.ideas}, rec_count = ${counts.recs}, done = true
             where bee_conversation_id = ${id}`;
}

// Deliberate "Earmark that" keys already saved from this conversation (recs and idea mentions). A re-run after a
// released claim skips these before any model call; the unique indexes in migration 008 are the backstop.
// Returns key -> the saved rec's canonical name (null for an idea), so ambient dedupe still knows the name on a retry.
export async function savedDeliberateKeys(id: number): Promise<Map<string, string | null>> {
  const rows = await db()`select deliberate_key, canonical_name from recommendations where bee_conversation_id = ${id} and deliberate_key is not null
                          union all
                          select deliberate_key, null from idea_mentions where bee_conversation_id = ${id} and deliberate_key is not null`;
  return new Map(rows.map((r) => [r.deliberate_key as string, (r.canonical_name as string | null) ?? null]));
}

export interface SavedRec { id: number; name: string; type: string; firstName: string | null; saidAt: Date }

// Recs saved from voice notes ("journal") or from conversations ("conversation") said between from and to, any status
// (a dismissed rec is still the item that moment produced). For the one-earmark-per-moment check (M2-T14).
export async function recsSaidBetween(from: Date, to: Date, origin: "journal" | "conversation"): Promise<SavedRec[]> {
  const rows = await db()`select r.id, r.canonical_name, r.type, rc.first_name, r.said_at
                          from recommendations r left join recommenders rc on rc.id = r.recommender_id
                          where r.said_at between ${from} and ${to}
                            and (case when ${origin}::text = 'journal' then r.bee_journal_id is not null
                                      else r.bee_conversation_id is not null end)`;
  return rows.map((r) => ({
    id: Number(r.id), name: r.canonical_name as string, type: r.type as string,
    firstName: (r.first_name as string | null) ?? null, saidAt: new Date(r.said_at as string),
  }));
}

// A voice note that repeats an item already saved from a conversation: the claim finishes pointing at that rec, and
// nothing new is stored.
export async function finishJournalAs(id: string, recId: number): Promise<void> {
  await db()`update processed_journals set item_type = 'rec', item_id = ${recId}, done = true where bee_journal_id = ${id}`;
}

// Undo a claim when the run failed after claiming, so the backfill can retry. Guarded: a slow run that outlived its
// lease must not delete a newer runner's finished (done) claim.
export async function releaseConversation(id: number): Promise<void> {
  await db()`delete from processed_conversations where bee_conversation_id = ${id} and done = false`;
}

export async function isJournalProcessed(id: string): Promise<boolean> {
  const rows = await db()`select 1 from processed_journals
                          where bee_journal_id = ${id}
                            and (done or processed_at >= now() - ${CLAIM_LEASE}::interval)`;
  return rows.length > 0;
}

// Claim: true only for the first caller (or whoever re-takes a stale unfinished claim). Journal ids are strings
// (stream numbers are normalized upstream). done = true records a finished outcome in one step (a non-trigger note).
export async function markJournalProcessed(
  id: string, item: { type: "idea" | "rec" | "none"; id: number | null }, done = false,
): Promise<boolean> {
  const rows = await db()`insert into processed_journals (bee_journal_id, item_type, item_id, done)
                          values (${id}, ${item.type}, ${item.id}, ${done})
                          on conflict (bee_journal_id) do update
                            set processed_at = now(), item_type = excluded.item_type, item_id = excluded.item_id, done = excluded.done
                            where processed_journals.done = false
                              and processed_journals.processed_at < now() - ${CLAIM_LEASE}::interval
                          returning bee_journal_id`;
  return rows.length === 1;
}

// Query builder: runs in the same transaction as the item insert, so the claim records its item (and done) or the save rolls back.
// Self-contained: finds the item by its journal id (inserted by an earlier statement in the same transaction).
export function journalItemQuery(txn: Txn, id: string, kind: "idea" | "rec") {
  return kind === "rec"
    ? txn`update processed_journals set item_type = 'rec', done = true,
            item_id = (select max(id) from recommendations where bee_journal_id = ${id}::text)
          where bee_journal_id = ${id}::text`
    : txn`update processed_journals set item_type = 'idea', done = true,
            item_id = (select max(cluster_id) from idea_mentions where bee_journal_id = ${id}::text)
          where bee_journal_id = ${id}::text`;
}

// Undo a claim when the run failed after claiming, so a later delivery or the backfill can retry. Guarded like
// releaseConversation: a done claim is never deleted.
export async function releaseJournal(id: string): Promise<void> {
  await db()`delete from processed_journals where bee_journal_id = ${id} and done = false`;
}
