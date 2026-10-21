// Send matched place tips with no OpenStreetMap link and no place details yet (decision 063: web-found places looked at
// before web details existed) back to the rec lane's extras step, once. Their stored extras stay: the step merges `place`.
//   pnpm requeue:place-details          dry run: lists the tip ids it would re-queue, writes nothing
//   pnpm requeue:place-details --yes    re-queues them (the next sweeps fetch them, 10 per run)
// Only places with a web link or street address, already looked at (extras_at set), with no `place` yet, still visible or maybe. Only ever the
// DATABASE_URL in .env.local. Prints ids and counts only, never names or text.
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { Pool, type PoolClient } from "@neondatabase/serverless";
import { databaseUrl } from "./resort";

const REQUEUE_WHERE = `type = 'place' and enrichment_status = 'matched' and not (coalesce(links, '{}'::jsonb) ? 'openstreetmap')
  and (coalesce(links, '{}'::jsonb) ? 'web' or coalesce(year_or_address, '') <> '') and extras_at is not null
  and not (coalesce(extras, '{}'::jsonb) ? 'place') and status not in ('dismissed', 'composted')`;

export async function requeuePlaceDetails(
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
    const { requeued } = await requeuePlaceDetails(c, { yes });
    console.log(yes ? "APPLIED" : "DRY RUN (read-only, nothing written; add --yes to write)");
    console.log(`place tips ${yes ? "re-queued" : "would be re-queued"} for extras: ${requeued.length} [${requeued.join(", ")}]`);
  } finally {
    c.release();
    await pool.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(`[requeue-place-details] failed error=${err instanceof Error ? err.name : "unknown"}${err instanceof Error && /^refusing/.test(err.message) ? ` ${err.message}` : ""}`);
    process.exit(1);
  });
}
