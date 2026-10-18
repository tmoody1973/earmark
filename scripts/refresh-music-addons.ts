// Backfill the music add-ons on tips that were matched before they existed (decision 047).
//   pnpm refresh:music-addons                  dry run: lists the tips missing an Apple link / Discogs data; no network, writes nothing
//   pnpm refresh:music-addons --yes            looks them up (Apple when APPLE_* is set, Discogs when DISCOGS_KEY/SECRET is set) and writes
//   pnpm refresh:music-addons --yes --limit 20 ...at most 20 tips this run (the rest next time)
// Albums, songs and artists that are matched and not dismissed/composted. Only ever ADDS: links.apple_music, links.discogs,
// extras.discogs, apple_music_id, and image_url when it is still null. Name, creator and art are never changed.
// Only the DATABASE_URL in .env.local. Sequential; Discogs keeps >= 1.1 s between calls itself; a 429 stops the run.
// Prints ids, counts and err.name only.
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { Pool, type PoolClient } from "@neondatabase/serverless";
import { appleAccess, type AppleAccess } from "../agent/lib/enrich/apple-music";
import { discogsAccess, fetchDiscogs, type DiscogsAccess } from "../agent/lib/enrich/discogs";
import { pickMatch } from "../agent/lib/enrich/match";
import { appleMusic } from "../agent/lib/enrich/music";
import { ProviderHttpError } from "../agent/lib/enrich/types";
import type { RecType } from "../agent/lib/types";
import { databaseUrl } from "./resort";

export const PAUSE_MS = 400; // a breath between tips; Discogs' own 1.1 s gap is enforced inside fetchDiscogs
const SKIP_STATUSES = ["dismissed", "composted"];

export interface RefreshDeps {
  apple: AppleAccess | null;
  discogs: DiscogsAccess | null;
  fetchImpl: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  scopeRecIds?: number[]; // integration tests narrow a run to their own rows; the CLI never does
  limit?: number;
}
export interface RefreshResult {
  candidates: number[]; missingApple: number[]; missingDiscogs: number[];
  appleAdded: number[]; discogsAdded: number[]; noMatch: number; failed: number; stoppedOn: string | null;
}
interface Row {
  id: number | string; type: RecType; canonical_name: string; creator: string | null; year_or_address: string | null;
  image_url: string | null; links: Record<string, string> | null; has_discogs: boolean;
}

export async function refreshMusicAddons(c: Pick<PoolClient, "query">, opts: { yes: boolean }, deps: RefreshDeps): Promise<RefreshResult> {
  const { rows } = await c.query(
    `select id, type, canonical_name, creator, year_or_address, image_url, links, (extras ? 'discogs') as has_discogs
     from recommendations
     where type in ('album', 'song', 'artist') and enrichment_status = 'matched' and status <> all($1::text[])
       and (($2::bigint[] is null) or id = any($2::bigint[]))
       and (coalesce(links->>'apple_music', '') = '' or not coalesce(extras ? 'discogs', false))
     order by id limit $3`,
    [SKIP_STATUSES, deps.scopeRecIds ?? null, deps.limit ?? 100_000]) as { rows: Row[] };
  const r: RefreshResult = {
    candidates: rows.map((x) => Number(x.id)),
    missingApple: rows.filter((x) => !x.links?.apple_music).map((x) => Number(x.id)),
    missingDiscogs: rows.filter((x) => !x.has_discogs).map((x) => Number(x.id)),
    appleAdded: [], discogsAdded: [], noMatch: 0, failed: 0, stoppedOn: null,
  };
  if (!opts.yes) return r;

  for (const [i, row] of rows.entries()) {
    if (i > 0) await deps.sleep(PAUSE_MS);
    const id = Number(row.id);
    const patch: { links: Record<string, string>; discogs: unknown; appleId: string | null; image: string | null } = { links: {}, discogs: null, appleId: null, image: null };
    try {
      if (deps.apple && !row.links?.apple_music) {
        const m = { canonicalName: row.canonical_name, creator: row.creator, yearOrAddress: row.year_or_address, imageUrl: row.image_url,
          links: row.links ?? {}, matchConfidence: 1 };
        const input = { recId: id, described: "", excerpt: "", query: { type: row.type, name: row.canonical_name, creator: row.creator, lat: null, lng: null } };
        const out = await appleMusic(m, input, { fetchImpl: deps.fetchImpl, pick: pickMatch, apple: deps.apple }); // never throws: a failure keeps the match
        if (out.links.apple_music) {
          patch.links.apple_music = out.links.apple_music;
          patch.appleId = out.appleMusicId ?? null;
          patch.image = row.image_url ? null : out.imageUrl;
        }
      }
      if (deps.discogs && !row.has_discogs) {
        const found = await fetchDiscogs({ type: row.type, canonical_name: row.canonical_name, creator: row.creator }, deps.discogs, deps.fetchImpl);
        if (found) {
          patch.links.discogs = found.url;
          patch.discogs = found;
        } else r.noMatch++;
        // ponytail: a miss stores nothing, so the next run asks again. Upgrade: a checked-at marker if misses pile up.
      }
    } catch (err) {
      if (err instanceof ProviderHttpError && err.status === 429) {
        r.stoppedOn = `${err.host} 429`;
        break;
      }
      r.failed++;
      console.error(`[refresh-music-addons] rec=${id} error=${err instanceof Error ? err.name : "unknown"}`);
      continue;
    }
    if (Object.keys(patch.links).length === 0) continue;
    await c.query(
      `update recommendations set
         links = coalesce(links, '{}'::jsonb) || $2::jsonb,
         extras = case when $3::jsonb is null then extras else coalesce(extras, '{}'::jsonb) || jsonb_build_object('discogs', $3::jsonb) end,
         apple_music_id = coalesce(apple_music_id, $4), image_url = coalesce(image_url, $5)
       where id = $1 and status <> all($6::text[])`,
      [id, JSON.stringify(patch.links), patch.discogs ? JSON.stringify(patch.discogs) : null, patch.appleId, patch.image, SKIP_STATUSES]);
    if (patch.links.apple_music) r.appleAdded.push(id);
    if (patch.discogs) r.discogsAdded.push(id);
  }
  return r;
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { yes: { type: "boolean" }, limit: { type: "string" } } });
  const url = databaseUrl();
  console.log(`database ${new URL(url).hostname.split(".")[0]} (.env.local DATABASE_URL)`);
  const limit = values.limit === undefined ? undefined : Number(values.limit);
  if (limit !== undefined && !(Number.isInteger(limit) && limit > 0)) throw new Error("--limit must be a positive whole number");
  const [apple, discogs] = [appleAccess(), discogsAccess()];
  const pool = new Pool({ connectionString: url });
  const c = await pool.connect();
  try {
    const yes = Boolean(values.yes);
    const r = await refreshMusicAddons(c, { yes }, {
      apple, discogs, fetchImpl: fetch, limit, sleep: (ms) => new Promise((res) => setTimeout(res, ms)),
    });
    console.log(yes ? "APPLIED" : "DRY RUN (no network calls, nothing written; add --yes to look up and write)");
    console.log(`configured: apple music ${apple ? "yes" : "no (APPLE_* unset)"}, discogs ${discogs ? "yes" : "no (DISCOGS_KEY/SECRET unset)"}`);
    console.log(`tips to look at: ${r.candidates.length} (missing an Apple link: ${r.missingApple.length}, missing Discogs data: ${r.missingDiscogs.length})`);
    if (!yes && r.candidates.length) console.log(`  ids [${r.candidates.join(", ")}]`);
    if (yes) {
      console.log(`  apple links added: ${r.appleAdded.length} [${r.appleAdded.join(", ")}]`);
      console.log(`  discogs added: ${r.discogsAdded.length} [${r.discogsAdded.join(", ")}], no confident match: ${r.noMatch}, failed: ${r.failed}`);
      if (r.stoppedOn) console.log(`  stopped early on ${r.stoppedOn}: wait a minute and run again`);
    }
  } finally {
    c.release();
    await pool.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(`[refresh-music-addons] failed error=${err instanceof Error ? err.name : "unknown"}${err instanceof Error && /^refusing/.test(err.message) ? ` ${err.message}` : ""}`);
    process.exit(1);
  });
}
