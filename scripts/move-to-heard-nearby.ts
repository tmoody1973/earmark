// Move the overheard tips nobody recommended, already on the shelf or in Maybe?, to Heard nearby (decision 052). New
// ones are saved there from the start (pipeline/save-item.ts recStatusAtSave); this catches the ones saved before.
//   pnpm move:heard          dry run: lists the tip ids it would move, writes nothing
//   pnpm move:heard --yes    moves them (status 'overheard'; the owner can still Keep any of them from /heard)
// Only overheard (ambient, no "Earmark that", no voice note) with no recommender, and only while 'new' or
// 'needs_review': never a tip the owner queued, tried, thanked, rated, cleared or composted. Only ever the DATABASE_URL
// in .env.local. Prints ids and counts only, never names or text.
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { Pool, type PoolClient } from "@neondatabase/serverless";
import { databaseUrl } from "./resort";

// The status core's other effects don't apply here: no recommender to recount, never a queued tip (no Bee todo).
const ELIGIBLE = `source = 'ambient' and deliberate_key is null and bee_journal_id is null and recommender_id is null
  and rating is null and status in ('new', 'needs_review')`;

export async function moveToHeardNearby(
  c: Pick<PoolClient, "query">, opts: { yes: boolean }, deps: { scopeRecIds?: number[] } = {},
): Promise<{ moved: number[] }> {
  const scope = deps.scopeRecIds ? " and id = any($1::bigint[])" : "";
  const args = deps.scopeRecIds ? [deps.scopeRecIds] : [];
  const { rows } = await c.query(`select id from recommendations where ${ELIGIBLE}${scope} order by id`, args);
  const moved = rows.map((r) => Number(r.id));
  if (opts.yes && moved.length > 0) {
    // Guarded again in the write: a tip the owner touched since the read stays where it is.
    await c.query(`update recommendations set status = 'overheard', updated_at = now() where id = any($1::bigint[]) and ${ELIGIBLE}`, [moved]);
  }
  return { moved };
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { yes: { type: "boolean" } } });
  const url = databaseUrl();
  console.log(`database ${new URL(url).hostname.split(".")[0]} (.env.local DATABASE_URL)`);
  const pool = new Pool({ connectionString: url });
  const c = await pool.connect();
  try {
    const yes = Boolean(values.yes);
    const { moved } = await moveToHeardNearby(c, { yes });
    console.log(yes ? "APPLIED" : "DRY RUN (read-only, nothing written; add --yes to write)");
    console.log(`overheard tips with no one recommending them ${yes ? "moved to" : "would move to"} Heard nearby: ${moved.length} [${moved.join(", ")}]`);
  } finally {
    c.release();
    await pool.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(`[move-to-heard-nearby] failed error=${err instanceof Error ? err.name : "unknown"}${err instanceof Error && /^refusing/.test(err.message) ? ` ${err.message}` : ""}`);
    process.exit(1);
  });
}
