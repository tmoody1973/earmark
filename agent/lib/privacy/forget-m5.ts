import { BlobNotFoundError } from "@vercel/blob";
import { weekOfSunday } from "../time";

// FR-30 coverage for the M5 stores, run as hooks of lane A's `pnpm forget` (forget-hooks.ts) with the forgotten item's
// first-save time and (for a rec) its recommender's first name, INSIDE its locked transaction: `sql` is a tag over that
// transaction's client, so a throw here rolls the whole forget back and a re-run retries. Fact proposals are not here:
// lane A's forget deletes them (by evidence) and their Bee facts itself.
//   findSweep / forgetSweep -> every weekly episode and gardener draft that may hold the item (episode audio last)
//   forgetPlaceNudges()     -> bee_sync rows of nudges whose place_nudges row cascaded away with the rec,
//                              then their Bee todos (text holds a place name and a friend's first name)
//   forgetRecReceipts()     -> the same sweep for rec_receipts (todo text names a friend and a tip)
// "May hold": neither table records its sources, and the text is model-written, so it can paraphrase the item (or quote
// its excerpt) without naming it. Anything made after the item was first saved may hold it: episodes from the Chicago
// week it was saved in (an episode's data is read during its week), drafts from that instant. Drafts read up to 60 recs
// and 30 ideas of any age. Plus anything naming the forgotten rec's recommender.
// A deleted week is NOT regenerated (the gardener stamps last_run_at, so that slot never runs again) and a deleted draft
// is gone, approved or not: this over-deletes the owner's own recaps, so the dry run shows the counts first.

// A tagged-template query: `${}` values become $1..$n parameters.
export type Sql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Record<string, unknown>[]>;
export interface ForgetEpisodeDeps {
  sql: Sql;
  del: (url: string) => Promise<void>;
}
export interface SweepScope { firstName: string | null; savedAt: Date | null }
export interface Sweep {
  episodes: { id: number; weekOf: string; audioUrl: string | null }[];
  drafts: { id: number; awaitingApproval: boolean }[];
}

const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const namesRe = (name: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(name)}(?![\\p{L}\\p{N}])`, "iu");
const alreadyGone = (err: unknown) => err instanceof BlobNotFoundError || (err as { status?: number } | null)?.status === 404;

/** Read-only: what forgetSweep would delete. Loading every row is fine: one episode a week, a few drafts. */
export async function findSweep({ firstName, savedAt }: SweepScope, sql: Sql): Promise<Sweep> {
  const name = firstName?.trim();
  const re = name ? namesRe(name) : null;
  const since = savedAt ? weekOfSunday(savedAt) : null; // YYYY-MM-DD, so string order is date order
  if (!re && !since) return { episodes: [], drafts: [] };
  const eps = (await sql`select id, week_of::text as week_of, script_md, audio_url from episodes`) as
    { id: number | string; week_of: string; script_md: string; audio_url: string | null }[];
  const runs = (await sql`select id, output_md, status, created_at from gardener_runs`) as
    { id: number | string; output_md: string; status: string; created_at: Date | string }[];
  return {
    episodes: eps
      .filter((r) => (since !== null && r.week_of >= since) || (re?.test(r.script_md) ?? false))
      .map((r) => ({ id: Number(r.id), weekOf: r.week_of, audioUrl: r.audio_url })),
    drafts: runs
      .filter((r) => (savedAt !== null && new Date(r.created_at) >= savedAt) || (re?.test(r.output_md) ?? false))
      .map((r) => ({ id: Number(r.id), awaitingApproval: r.status === "draft" })),
  };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Counts and dates only: "2 episodes (weeks 2026-10-04–2026-10-11) and 1 draft, including 1 awaiting approval". */
export function describeSweep({ episodes, drafts }: Sweep): string {
  const weeks = episodes.map((e) => e.weekOf).sort();
  const span = weeks.length === 0 ? "" : weeks.length === 1 ? ` (week ${weeks[0]})` : ` (weeks ${weeks[0]}–${weeks.at(-1)})`;
  const awaiting = drafts.filter((d) => d.awaitingApproval).length;
  return `${plural(episodes.length, "episode")}${span} and ${plural(drafts.length, "draft")}, including ${awaiting} awaiting approval`;
}

/** Deletes the drafts, then the episodes, then the episodes' Blob audio. */
export async function forgetSweep(scope: SweepScope, deps: ForgetEpisodeDeps): Promise<{ sweep: Sweep; audioDeleted: number }> {
  const sweep = await findSweep(scope, deps.sql);
  for (const d of sweep.drafts) await deps.sql`delete from gardener_runs where id = ${d.id}`;
  for (const e of sweep.episodes) await deps.sql`delete from episodes where id = ${e.id}`;
  // Blob last: its deletes cannot roll back, so they wait until every row delete has succeeded. Already gone = done;
  // any other failure throws, the rows come back, and a re-run deletes them and retries the audio.
  let audioDeleted = 0;
  for (const e of sweep.episodes) {
    if (!e.audioUrl) continue;
    try {
      await deps.del(e.audioUrl);
    } catch (err) {
      if (!alreadyGone(err)) throw err;
    }
    audioDeleted++;
  }
  return { sweep, audioDeleted };
}

// Todos Earmark made for M5 entities (createEarmarkTodo). Their Bee text names a friend and a place or tip, and each
// entity is its own bee_sync row (entity_id = the owning row's id). By the time this runs the forgotten rec's owning rows
// have cascaded away, so every bee_sync row whose owner no longer exists is an orphan of a forgotten rec: delete them
// inside the transaction, then their Bee todos (those cannot roll back, so they come after). A 404 is already gone;
// anything else throws, the forget rolls back, and a re-run finds the rows again and retries.
// Two fixed statements, one per entity type; no SQL is built from input.
type TodoEntity = "place_nudge" | "rec_receipt";

export async function forgetOrphanedTodos(
  entityType: TodoEntity,
  deps: Pick<ForgetEpisodeDeps, "sql"> & { deleteTodo: (id: number) => Promise<void> },
): Promise<{ beeTodoIds: number[] }> {
  const rows = (await (entityType === "place_nudge"
    ? deps.sql`
      delete from bee_sync s
      where s.entity_type = 'place_nudge' and s.bee_object = 'todo'
        and not exists (select 1 from place_nudges n where n.id = s.entity_id)
      returning s.bee_id`
    : deps.sql`
      delete from bee_sync s
      where s.entity_type = 'rec_receipt' and s.bee_object = 'todo'
        and not exists (select 1 from rec_receipts n where n.id = s.entity_id)
      returning s.bee_id`)) as { bee_id: number | string }[];
  const beeTodoIds = rows.map((r) => Number(r.bee_id));
  for (const id of beeTodoIds) {
    try {
      await deps.deleteTodo(id);
    } catch (err) {
      if ((err as { status?: number } | null)?.status !== 404) throw err;
    }
  }
  return { beeTodoIds };
}

export const forgetPlaceNudges = (deps: Parameters<typeof forgetOrphanedTodos>[1]) => forgetOrphanedTodos("place_nudge", deps);
export const forgetRecReceipts = (deps: Parameters<typeof forgetOrphanedTodos>[1]) => forgetOrphanedTodos("rec_receipt", deps);
