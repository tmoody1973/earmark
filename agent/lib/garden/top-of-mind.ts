import { db } from "../db";
import { gardenReadOnly } from "../e2e-guard";
import { blockedNames, ideaFactText } from "../facts/proposals";
import { nameAppearsIn } from "../pipeline/attribution";

// Top of Mind (FR-35): a pinned idea is matched more easily (PINNED_MATCH_MIN, choose-cluster.ts), is offered to the
// cluster choice even from just outside the 5 nearest (pinnedClustersNear, store/ideas.ts), is flagged in the garden the
// moment a mention joins it (save-item.ts), and gets one pending Bee fact. Pins are the owner's short list, so capped.
export const PIN_CAP = 5;

type Env = Record<string, string | undefined>;
// refused: why nothing changed. note: what the owner should know about a change that went through.
export type PinResult = { changed: boolean; refused?: string; note?: string };

// One pin change at a time (pg_advisory_xact_lock key), so the cap's count can't race: two tabs at 4 never make 6.
const PIN_LOCK = 3_500_035;
export const FACT_KEPT_NOTE = "Unpinned. Its Bee fact stays until you delete it in the Bee app.";

/**
 * Pin or unpin an idea. Idempotent: pinning a pinned idea (or unpinning an unpinned one) changes nothing. A dismissed
 * idea can't be pinned. At PIN_CAP live pins a new pin is refused with the reason, and nothing changes.
 */
export async function setPinned(id: number, pinned: boolean, env: Env = process.env): Promise<PinResult> {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("invalid idea id");
  if (gardenReadOnly(env)) return { changed: false }; // a real-data e2e run browses read-only (e2e-guard.ts)
  const sql = db();
  const evidence = JSON.stringify([id]);
  if (!pinned) {
    const rows = await sql`update idea_clusters set pinned = false where id = ${id} and pinned returning id`;
    if (rows.length === 0) return { changed: false };
    // The pin's fact goes too while it is only a local row: never once the weekly writer has claimed it (a post may be
    // in flight) or posted it (it is in Bee; the owner deletes it there), and then the owner is told so.
    await sql`delete from fact_proposals
      where kind = 'idea' and status = 'pending' and bee_fact_id is null and write_started_at is null
        and evidence_ids @> ${evidence}::jsonb`;
    const sent = await sql`select 1 from fact_proposals
      where kind = 'idea' and status <> 'rejected' and (bee_fact_id is not null or write_started_at is not null)
        and evidence_ids @> ${evidence}::jsonb limit 1`;
    return sent.length > 0 ? { changed: true, note: FACT_KEPT_NOTE } : { changed: true };
  }
  const [, rows] = (await sql.transaction([
    sql`select pg_advisory_xact_lock(${PIN_LOCK})`,
    sql`update idea_clusters set pinned = true
      where id = ${id} and not pinned and stage <> 'dismissed'
        and (select count(*) from idea_clusters where pinned and stage <> 'dismissed') < ${PIN_CAP}
      returning title, mention_count, first_mentioned_at, bee_fact_id`,
  ])) as [unknown, PinnedRow[]];
  if (rows.length === 0) {
    const [c] = (await sql`select pinned, stage from idea_clusters where id = ${id}`) as { pinned: boolean; stage: string }[];
    const atCap = c !== undefined && !c.pinned && c.stage !== "dismissed";
    return atCap ? { changed: false, refused: `Top of Mind holds ${PIN_CAP} ideas. Unpin one to make room.` } : { changed: false };
  }
  try {
    await proposePinnedFact(id, rows[0]!, env);
  } catch (err) {
    // The pin stands; only its fact is missing. Ids and error name only.
    console.error("[top-of-mind] fact proposal failed", { ideaId: id, error: err instanceof Error ? err.name : "unknown" });
  }
  return { changed: true };
}

type PinnedRow = { title: string; mention_count: number; first_mentioned_at: string | null; bee_fact_id: string | number | null };

/**
 * One pending idea fact, written to Bee (as an UNCONFIRMED fact) only by the weekly writer, writePendingProposals in
 * facts/proposals.ts; nothing here calls Bee. Behind the Bee kill switch: no BEE_TODO_WRITES=on, no proposal. Never for
 * an idea already linked to a Bee fact, never twice for one idea (whatever its status: a fact the owner deleted in Bee
 * is not proposed again), and never when the title names the owner or a recommender (facts describe only the owner).
 */
async function proposePinnedFact(id: number, c: PinnedRow, env: Env): Promise<void> {
  if (env.BEE_TODO_WRITES !== "on" || c.bee_fact_id !== null) return;
  const names = await blockedNames();
  if (names.some((n) => nameAppearsIn(n, c.title))) return;
  const evidence = JSON.stringify([id]);
  await db()`insert into fact_proposals (text, kind, evidence_ids)
    select ${ideaFactText(c.title, Number(c.mention_count), c.first_mentioned_at)}, 'idea', ${evidence}::jsonb
    where not exists (select 1 from fact_proposals where kind = 'idea' and evidence_ids @> ${evidence}::jsonb)
      and exists (select 1 from idea_clusters where id = ${id} and pinned)`; // an unpin in between leaves no fact
}
