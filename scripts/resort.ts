// Re-sort the existing garden by the tuned thresholds, reversibly (M2-T10b, decision 010).
//   pnpm resort                   dry run: read-only, prints counts and ids per transition
//   pnpm resort --apply           one transaction: backup rows (run_id), status updates, idea counts and stages
//   pnpm resort --undo <run_id>   one transaction: restores old statuses, counts and stages from the backup
// Only ever the DATABASE_URL in .env.local. Prints ids, counts and err.name only, never text.
import { readFileSync } from "node:fs";
import { parseArgs, parseEnv } from "node:util";
import { pathToFileURL } from "node:url";
import { Pool, type PoolClient } from "@neondatabase/serverless";
import {
  planClusters, planResort, type ClusterMove, type ClusterRow, type ResortMove, type ResortRow,
} from "../agent/lib/pipeline/resort";
import type { IdeaStage } from "../agent/lib/types";

// Integration tests narrow a run to their own rows; the CLI never does.
export interface Scope { recIds: number[]; mentionIds: number[] }
export interface ResortResult { runId: string | null; moves: ResortMove[]; clusters: ClusterMove[] }
export interface UndoResult { restored: ResortMove[]; skipped: number; clusters: ClusterMove[] }


async function readEligible(c: PoolClient, lock: boolean, scope?: Scope) {
  const tail = `${scope ? " and id = any($1::bigint[])" : ""}${lock ? " for update" : ""}`;
  const recs = await c.query(
    `select id, status, confidence, source, deliberate_key from recommendations
     where status in ('new', 'needs_review')${tail}`, scope ? [scope.recIds] : []);
  const mentions = await c.query(
    `select id, cluster_id, review_status as status, confidence, source, deliberate_key from idea_mentions
     where review_status in ('accepted', 'needs_review')${tail}`, scope ? [scope.mentionIds] : []);
  const row = (table: ResortRow["table"]) => (r: Record<string, unknown>): ResortRow => ({
    table, id: Number(r.id), status: String(r.status), source: String(r.source),
    confidence: r.confidence === null ? null : Number(r.confidence), deliberateKey: (r.deliberate_key as string | null) ?? null,
  });
  const clusterOf = new Map(mentions.rows.map((r) => [Number(r.id), Number(r.cluster_id)]));
  return { rows: [...recs.rows.map(row("recommendations")), ...mentions.rows.map(row("idea_mentions"))], clusterOf };
}

async function readClusters(c: PoolClient, clusterIds: number[], lock: boolean): Promise<ClusterRow[]> {
  const { rows } = await c.query(
    `select id, stage, mention_count from idea_clusters where id = any($1::bigint[]) order by id${lock ? " for update" : ""}`,
    [clusterIds]);
  return rows.map((r) => ({ id: Number(r.id), stage: r.stage as IdeaStage, mentionCount: Number(r.mention_count) }));
}

async function writeStatuses(c: PoolClient, moves: readonly ResortMove[], field: "from" | "to") {
  for (const [table, col] of [["recommendations", "status"], ["idea_mentions", "review_status"]] as const) {
    const ms = moves.filter((m) => m.table === table);
    if (ms.length === 0) continue;
    await c.query(`update ${table} t set ${col} = u.s from unnest($1::bigint[], $2::text[]) u(id, s) where t.id = u.id`,
      [ms.map((m) => m.id), ms.map((m) => m[field])]);
  }
}

async function writeClusters(c: PoolClient, cs: readonly ClusterMove[]) {
  if (cs.length === 0) return;
  await c.query(
    `update idea_clusters t set mention_count = u.n, stage = u.s, updated_at = now()
     from unnest($1::bigint[], $2::int[], $3::text[]) u(id, n, s) where t.id = u.id`,
    [cs.map((x) => x.id), cs.map((x) => x.toCount), cs.map((x) => x.toStage)]);
}

async function inTransaction<T>(c: PoolClient, readOnly: boolean, work: () => Promise<{ value: T; commit: boolean }>): Promise<T> {
  await c.query(readOnly ? "begin transaction read only" : "begin");
  try {
    const { value, commit } = await work();
    await c.query(commit ? "commit" : "rollback");
    return value;
  } catch (err) {
    // A failed rollback (dropped connection) must not hide why the transaction failed; Postgres aborts it anyway.
    try {
      await c.query("rollback");
    } catch (rollbackErr) {
      console.error(`[resort] rollback failed error=${rollbackErr instanceof Error ? rollbackErr.name : "unknown"}`);
    }
    throw err;
  }
}

// Dry run (apply false) runs in a READ ONLY transaction, so it cannot write even by mistake.
export async function resort(c: PoolClient, opts: { apply: boolean; scope?: Scope }): Promise<ResortResult> {
  return inTransaction<ResortResult>(c, !opts.apply, async () => {
    const { rows, clusterOf } = await readEligible(c, opts.apply, opts.scope);
    const moves = planResort(rows);
    const mentionMoves = moves.filter((m) => m.table === "idea_mentions").map((m) => ({ ...m, clusterId: clusterOf.get(m.id)! }));
    const clusters = planClusters(mentionMoves, await readClusters(c, [...new Set(mentionMoves.map((m) => m.clusterId))], opts.apply));
    if (!opts.apply || moves.length === 0) return { value: { runId: null, moves, clusters }, commit: false };

    const runId = `resort-${new Date().toISOString().replace(/[-:.]/g, "")}`;
    const backup = [
      ...moves.map((m) => [m.table, m.id, m.from, m.to, m.confidence] as const),
      ...clusters.map((x) => ["idea_clusters", x.id, x.fromStage, x.toStage, null] as const),
    ];
    await c.query(
      `insert into resort_backup (run_id, table_name, row_id, old_status, new_status, confidence)
       select $1, t, id, o, n, conf from unnest($2::text[], $3::bigint[], $4::text[], $5::text[], $6::real[]) u(t, id, o, n, conf)`,
      [runId, ...[0, 1, 2, 3, 4].map((i) => backup.map((b) => b[i]))]);
    await writeStatuses(c, moves, "to");
    await writeClusters(c, clusters);
    return { value: { runId, moves, clusters }, commit: true };
  });
}

// Restores a row only while it still holds what the re-sort wrote: anything Tarik (or the pipeline) changed since
// is left alone and counted as skipped. Counts are reversed by the restored mentions; a stage goes back to its
// backed-up value while it is still the value the re-sort set, else it follows the restored count via stageFor.
export async function undoResort(c: PoolClient, runId: string): Promise<UndoResult> {
  return inTransaction<UndoResult>(c, false, async () => {
    const { rows: backup } = await c.query(
      `select table_name, row_id, old_status, new_status, confidence from resort_backup where run_id = $1`, [runId]);
    if (backup.length === 0) throw new UnknownRunError();
    const toRestore = backup.filter((b) => b.table_name !== "idea_clusters").map((b): ResortMove => ({
      table: b.table_name, id: Number(b.row_id), from: b.old_status, to: b.new_status, confidence: Number(b.confidence),
    }));
    const current = new Map<string, { status: string; clusterId: number | null }>();
    for (const [table, col] of [["recommendations", "status"], ["idea_mentions", "review_status"]] as const) {
      const want = toRestore.filter((m) => m.table === table).map((m) => m.id);
      const { rows } = await c.query(
        `select id, ${col} as status, ${table === "idea_mentions" ? "cluster_id" : "null"} as cluster_id
         from ${table} where id = any($1::bigint[]) for update`, [want]);
      for (const r of rows) current.set(`${table}:${r.id}`, { status: r.status, clusterId: r.cluster_id === null ? null : Number(r.cluster_id) });
    }
    const restored = toRestore.filter((m) => current.get(`${m.table}:${m.id}`)?.status === m.to);
    await writeStatuses(c, restored, "from");

    const reversed = restored.filter((m) => m.table === "idea_mentions")
      .map((m) => ({ clusterId: current.get(`idea_mentions:${m.id}`)!.clusterId!, from: m.to, to: m.from }));
    const before = await readClusters(c, [...new Set(reversed.map((m) => m.clusterId))], true);
    const backedUp = new Map(backup.filter((b) => b.table_name === "idea_clusters").map((b) => [Number(b.row_id), b]));
    const clusters = planClusters(reversed, before).map((x) => {
      const b = backedUp.get(x.id);
      return b && x.fromStage === b.new_status ? { ...x, toStage: b.old_status as IdeaStage } : x;
    });
    await writeClusters(c, clusters);
    return { value: { restored, skipped: toRestore.length - restored.length, clusters }, commit: true };
  });
}

export class UnknownRunError extends Error {
  override name = "UnknownRunError";
}

// Groups moves by table and transition: "recommendations new → dismissed: 3 [12, 15, 40]".
export function summarize(moves: readonly ResortMove[], clusters: readonly ClusterMove[]): string[] {
  const groups = new Map<string, number[]>();
  const add = (key: string, id: number) => groups.set(key, [...(groups.get(key) ?? []), id]);
  for (const m of moves) add(`${m.table} ${m.from} → ${m.to}`, m.id);
  for (const x of clusters) add(`idea_clusters ${x.fromStage} → ${x.toStage} (count ${x.fromCount} → ${x.toCount})`, x.id);
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}: ${v.length} [${v.join(", ")}]`);
}

// The only database this script will touch: DATABASE_URL exactly as written in .env.local (a shell override, or
// TEST_DATABASE_URL swapped in, is refused).
function databaseUrl(): string {
  const fromFile = parseEnv(readFileSync(".env.local", "utf8")).DATABASE_URL;
  if (!fromFile || process.env.DATABASE_URL !== fromFile) {
    throw new Error("refusing: DATABASE_URL must be set and equal to the one in .env.local");
  }
  return fromFile;
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { apply: { type: "boolean" }, undo: { type: "string" } } });
  if (values.apply && values.undo) throw new Error("use --apply or --undo <run_id>, not both");
  const url = databaseUrl();
  console.log(`database ${new URL(url).hostname.split(".")[0]} (.env.local DATABASE_URL)`);
  const pool = new Pool({ connectionString: url });
  const c = await pool.connect();
  try {
    if (values.undo) {
      const r = await undoResort(c, values.undo);
      console.log(`undo ${values.undo}: restored ${r.restored.length}, skipped ${r.skipped} (changed since the re-sort)`);
      for (const line of summarize(r.restored.map((m) => ({ ...m, from: m.to, to: m.from })), r.clusters)) console.log(`  ${line}`);
      return;
    }
    const r = await resort(c, { apply: Boolean(values.apply) });
    console.log(values.apply ? `applied run_id ${r.runId ?? "(nothing to change)"}` : "DRY RUN (read-only, nothing written)");
    console.log(`${r.moves.length} row changes, ${r.clusters.length} idea count/stage changes`);
    for (const line of summarize(r.moves, r.clusters)) console.log(`  ${line}`);
    if (r.runId) console.log(`undo with: pnpm resort --undo ${r.runId}`);
  } finally {
    c.release();
    await pool.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(`[resort] failed error=${err instanceof Error ? err.name : "unknown"}${err instanceof Error && /^refusing|^use --/.test(err.message) ? ` ${err.message}` : ""}`);
    process.exit(1);
  });
}
