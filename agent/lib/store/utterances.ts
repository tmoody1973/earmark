import { db } from "../db";
import { CLAIM_LEASE, type Txn } from "./conversations";

// Rows are written by M1's bufferUtterance (store/conversations.ts); live triage (pipeline/live.ts) claims them here.
export interface BufferedUtterance { id: number; speaker: string; text: string; receivedAt: Date; spokenAt: Date | null }

// Live windows: 4 utterances, NOT overlapping (stride 4), so one triage call per 4 utterances while recording —
// half the calls of the completed pass's 4/2 windows (Tarik's cost ruling, fix round 1). An idea split across two live
// windows may be missed live; the completed pass still finds it.
export const LIVE_WINDOW = { size: 4, stride: 4 } as const;

// Claims the conversation's open utterances (not done, not under a live claim) once a full window's worth is waiting:
// at least `stride` open AND at least `size` buffered in all. Returns the claimed ids plus the rows the windows need,
// oldest first: up to size - stride earlier utterances for context, then every row from the first claimed id to the
// last (a retaken stale claim plus new rows can be non-contiguous); null = nothing claimed.
// Done-lease pattern (like processed_conversations): `triaged` = done, set in the save transaction
// (finishUtterancesQuery); an unfinished claim older than CLAIM_LEASE can be re-taken by a later delivery.
// FOR UPDATE SKIP LOCKED: a concurrent delivery skips rows another is claiming, so no utterance is triaged twice.
export async function claimUtterances(
  conversationUuid: string, opts: { size: number; stride: number } = LIVE_WINDOW,
): Promise<{ claimed: number[]; rows: BufferedUtterance[] } | null> {
  const claimedRows = await db()`
    with open as (
      select id from utterance_buffer
      where conversation_uuid = ${conversationUuid} and not triaged
        and (claimed_at is null or claimed_at < now() - ${CLAIM_LEASE}::interval)
      order by id
      for update skip locked
    )
    update utterance_buffer set claimed_at = now()
    where id in (select id from open)
      and (select count(*) from open) >= ${opts.stride}
      and (select count(*) from utterance_buffer where conversation_uuid = ${conversationUuid}) >= ${opts.size}
    returning id`;
  if (claimedRows.length === 0) return null;
  const claimed = claimedRows.map((r) => Number(r.id)).sort((a, b) => a - b);
  const rows = await db()`
    (select id, speaker, text, received_at, spoken_at from utterance_buffer
     where conversation_uuid = ${conversationUuid} and id < ${claimed[0]!}
     order by id desc limit ${opts.size - opts.stride})
    union all
    (select id, speaker, text, received_at, spoken_at from utterance_buffer
     where conversation_uuid = ${conversationUuid} and id between ${claimed[0]!} and ${claimed.at(-1)!})
    order by id`;
  return {
    claimed,
    rows: rows.map((r) => ({
      id: Number(r.id), speaker: String(r.speaker), text: String(r.text), receivedAt: new Date(r.received_at),
      spokenAt: r.spoken_at === null ? null : new Date(r.spoken_at),
    })),
  };
}

// Query builder: marks claimed utterances done inside the transaction that saves what their windows found.
export function finishUtterancesQuery(txn: Txn, ids: readonly number[]) {
  return txn`update utterance_buffer set triaged = true where id = any(${ids as number[]}::bigint[])`;
}

export async function conversationIdForUuid(conversationUuid: string): Promise<number | null> {
  const rows = await db()`select bee_conversation_id from bee_conversation_map where conversation_uuid = ${conversationUuid}`;
  return rows.length ? Number(rows[0]!.bee_conversation_id) : null;
}
