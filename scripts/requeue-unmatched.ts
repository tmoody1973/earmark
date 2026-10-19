// Send the tips the lane couldn't match back for one fresh look, so it keeps their candidates this time and the owner
// can answer "Which one?" (decision 048). Tips matched before 048 never stored candidates; this only fixes the stuck ones.
//   pnpm requeue:unmatched          dry run: lists the tip ids it would re-queue, writes nothing
//   pnpm requeue:unmatched --yes    re-queues them (the next 10-minute sweep looks them up again)
// Only automatic no-matches (match_source 'auto') on tips still visible or maybe: never one the owner settled, never a
// cleared tip. Only ever the DATABASE_URL in .env.local. Prints ids and counts only, never names or text.
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { Pool, type PoolClient } from "@neondatabase/serverless";
import { databaseUrl } from "./resort";

// Re-queue = a fresh lookup: the columns a new tip starts with (011_rec_enrichment.sql), as backfill-said-location does.
const REQUEUE_WHERE = `enrichment_status = 'no_match' and match_source = 'auto' and status not in ('dismissed', 'composted')`;

export async function requeueUnmatched(
  c: Pick<PoolClient, "query">, opts: { yes: boolean }, deps: { scopeRecIds?: number[] } = {},
): Promise<{ requeued: number[] }> {
  const scope = deps.scopeRecIds ? " and id = any($1::bigint[])" : "";
  const args = deps.scopeRecIds ? [deps.scopeRecIds] : [];
  const { rows } = await c.query(`select id from recommendations where ${REQUEUE_WHERE}${scope} order by id`, args);
  const requeued = rows.map((r) => Number(r.id));
  if (opts.yes && requeued.length > 0) {
    await c.query(
      `update recommendations set enrichment_status = 'pending', enrich_attempts = 0, enrich_next_at = now(), pending_since = now(),
              enriched_at = null, review_reason = case when review_reason = 'no_match' then null else review_reason end
       where id = any($1::bigint[]) and ${REQUEUE_WHERE}`, [requeued]);
  }
  return { requeued };
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { yes: { type: "boolean" } } });
  const url = databaseUrl();
  console.log(`database ${new URL(url).hostname.split(".")[0]} (.env.local DATABASE_URL)`);
  const pool = new Pool({ connectionString: url });
  const c = await pool.connect();
  try {
    const yes = Boolean(values.yes);
    const { requeued } = await requeueUnmatched(c, { yes });
    console.log(yes ? "APPLIED" : "DRY RUN (read-only, nothing written; add --yes to write)");
    console.log(`unmatched tips ${yes ? "re-queued" : "would be re-queued"}: ${requeued.length} [${requeued.join(", ")}]`);
  } finally {
    c.release();
    await pool.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(`[requeue-unmatched] failed error=${err instanceof Error ? err.name : "unknown"}${err instanceof Error && /^refusing/.test(err.message) ? ` ${err.message}` : ""}`);
    process.exit(1);
  });
}
