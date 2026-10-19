// Backfill where each conversation-heard tip was said, and optionally re-queue the place tips that never matched
// (decision 046).
//   pnpm backfill:said-location                           dry run: reads Bee + the database, writes nothing
//   pnpm backfill:said-location --yes                     sets said_lat/said_lng from Bee's primary_location
//   pnpm backfill:said-location --yes --requeue-places    ...and sends unmatched place tips back to the rec lane
// Only ever the DATABASE_URL in .env.local. Bee is read-only (GET one conversation at a time, a pause between).
// Prints ids, counts and err.name only, never coordinates or text.
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { Pool, type PoolClient } from "@neondatabase/serverless";
import { createBeeClient } from "../agent/lib/bee/client";
import { databaseUrl } from "./resort";

export const BEE_PAUSE_MS = 400; // sequential, with a breath between calls, so Bee's rate limit is never the story

type Location = { latitude: number; longitude: number } | null | undefined;
export interface BackfillDeps {
  getLocation: (conversationId: number) => Promise<Location>;
  sleep: (ms: number) => Promise<void>;
  scopeRecIds?: number[]; // integration tests narrow a run to their own rows; the CLI never does
}
export interface BackfillResult {
  conversations: number; located: number[]; noLocation: number; failed: number; // located = rec ids that got (or would get) a location
  requeued: number[];
}

// Re-queue = a fresh lookup: same columns a new tip starts with (011_rec_enrichment.sql), plus clearing a stale "no match" flag.
// match_source 'auto': never a tip the owner settled ("Which one?", decision 048).
const REQUEUE_WHERE = `type = 'place' and lat is null and match_source = 'auto' and status not in ('dismissed', 'composted')`;

export async function backfillSaidLocation(
  c: Pick<PoolClient, "query">, opts: { yes: boolean; requeuePlaces: boolean }, deps: BackfillDeps,
): Promise<BackfillResult> {
  const scope = deps.scopeRecIds ? " and id = any($1::bigint[])" : "";
  const args = deps.scopeRecIds ? [deps.scopeRecIds] : [];
  const { rows } = await c.query(
    `select bee_conversation_id as conv, array_agg(id order by id) as ids from recommendations
     where bee_conversation_id is not null and said_lat is null${scope} group by 1 order by 1`, args);
  const r: BackfillResult = { conversations: rows.length, located: [], noLocation: 0, failed: 0, requeued: [] };
  for (const [i, row] of rows.entries()) {
    if (i > 0) await deps.sleep(BEE_PAUSE_MS);
    const conv = Number(row.conv);
    try {
      const loc = await deps.getLocation(conv);
      if (!loc) { r.noLocation++; continue; }
      const ids = (row.ids as (string | number)[]).map(Number);
      if (opts.yes) {
        await c.query(`update recommendations set said_lat = $1, said_lng = $2 where id = any($3::bigint[]) and said_lat is null`,
          [loc.latitude, loc.longitude, ids]);
      }
      r.located.push(...ids);
    } catch (err) {
      r.failed++;
      console.error(`[backfill-said-location] conversation=${conv} error=${err instanceof Error ? err.name : "unknown"}`);
    }
  }
  if (opts.requeuePlaces) {
    const q = await c.query(`select id from recommendations where ${REQUEUE_WHERE}${scope} order by id`, args);
    r.requeued = q.rows.map((x) => Number(x.id));
    if (opts.yes && r.requeued.length > 0) {
      await c.query(
        `update recommendations set enrichment_status = 'pending', enrich_attempts = 0, enrich_next_at = now(), pending_since = now(),
                enriched_at = null, review_reason = case when review_reason = 'no_match' then null else review_reason end
         where id = any($1::bigint[])`, [r.requeued]);
    }
  }
  return r;
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { yes: { type: "boolean" }, "requeue-places": { type: "boolean" } } });
  const url = databaseUrl();
  console.log(`database ${new URL(url).hostname.split(".")[0]} (.env.local DATABASE_URL)`);
  const bee = createBeeClient();
  const pool = new Pool({ connectionString: url });
  const c = await pool.connect();
  try {
    const yes = Boolean(values.yes);
    const r = await backfillSaidLocation(c, { yes, requeuePlaces: Boolean(values["requeue-places"]) }, {
      getLocation: async (id) => (await bee.getConversation(id)).conversation.primary_location,
      sleep: (ms) => new Promise((res) => setTimeout(res, ms)),
    });
    console.log(yes ? "APPLIED" : "DRY RUN (read-only, nothing written; add --yes to write)");
    console.log(`conversations checked: ${r.conversations}, with a location: ${r.located.length} recs, without: ${r.noLocation} conversations, failed: ${r.failed}`);
    if (r.located.length) console.log(`  said location ${yes ? "set" : "would be set"} on recs [${r.located.join(", ")}]`);
    if (values["requeue-places"]) console.log(`  place tips ${yes ? "re-queued" : "would be re-queued"}: ${r.requeued.length} [${r.requeued.join(", ")}]`);
  } finally {
    c.release();
    await pool.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(`[backfill-said-location] failed error=${err instanceof Error ? err.name : "unknown"}${err instanceof Error && /^refusing/.test(err.message) ? ` ${err.message}` : ""}`);
    process.exit(1);
  });
}
