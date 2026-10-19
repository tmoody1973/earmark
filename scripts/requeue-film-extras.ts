// Send matched film and TV tips whose extras were looked up before TMDB extras existed (decision 056) back to the rec
// lane's extras step, once. Their stored extras stay: the step merges the new `film` into them.
//   pnpm requeue:film-extras          dry run: lists the tip ids it would re-queue, writes nothing
//   pnpm requeue:film-extras --yes    re-queues them (the next sweeps fetch them, 10 per run)
// Only tips with a TMDB link, already looked at (extras_at set), with no `film` yet, still visible or maybe. Only ever the
// DATABASE_URL in .env.local. Prints ids and counts only, never names or text.
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { Pool, type PoolClient } from "@neondatabase/serverless";
import { databaseUrl } from "./resort";

const REQUEUE_WHERE = `type = 'film_tv' and enrichment_status = 'matched' and links ? 'tmdb' and extras_at is not null
  and not (coalesce(extras, '{}'::jsonb) ? 'film') and status not in ('dismissed', 'composted')`;

export async function requeueFilmExtras(
  c: Pick<PoolClient, "query">, opts: { yes: boolean }, deps: { scopeRecIds?: number[] } = {},
): Promise<{ requeued: number[] }> {
  const scope = deps.scopeRecIds ? " and id = any($1::bigint[])" : "";
  const args = deps.scopeRecIds ? [deps.scopeRecIds] : [];
  const { rows } = await c.query(`select id from recommendations where ${REQUEUE_WHERE}${scope} order by id`, args);
  const requeued = rows.map((r) => Number(r.id));
  if (opts.yes && requeued.length > 0) {
    await c.query(`update recommendations set extras_at = null, extras_tries = 0 where id = any($1::bigint[]) and ${REQUEUE_WHERE}`,
      [requeued]);
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
    const { requeued } = await requeueFilmExtras(c, { yes });
    console.log(yes ? "APPLIED" : "DRY RUN (read-only, nothing written; add --yes to write)");
    console.log(`film/TV tips ${yes ? "re-queued" : "would be re-queued"} for extras: ${requeued.length} [${requeued.join(", ")}]`);
  } finally {
    c.release();
    await pool.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(`[requeue-film-extras] failed error=${err instanceof Error ? err.name : "unknown"}${err instanceof Error && /^refusing/.test(err.message) ? ` ${err.message}` : ""}`);
    process.exit(1);
  });
}
