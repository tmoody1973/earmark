// The rec lane (M3-T4, decision 013): every tip waits as enrichment_status = 'pending' until the cron sweep looks it
// up. Providers (MusicBrainz above all, decision 012) are called ONLY from sweepRecLane: one tip at a time, under a
// Postgres advisory lock so sweeps never overlap, bounded per run, stopping on the first 503/429.
// Everything else calls runRecLane(id), which never calls a provider.
import { Pool } from "@neondatabase/serverless";
import { db, inTransaction } from "../db";
import { enrichRec, type RecToEnrich } from "../enrich/enrich";
import { pickMatch } from "../enrich/match";
import { enabledTypes, REC_TYPES } from "../enrich/registry";
import { logEnrichError, ProviderHttpError, type EnrichmentMatch } from "../enrich/types";
import { getEnv } from "../env";
import { HIDDEN_TIP_STATUSES } from "../garden/queries";
import type { RecStatus, RecType } from "../types";

export const MAX_RECS_PER_RUN = 10;
export const MAX_JEV_CALLS_PER_RUN = 8; // ≤1 Jev call per tip; tips with no candidates cost none
export const MAX_ATTEMPTS = 5; // then enrichment_status = 'failed' and the sweep never tries it again
export const SWEEP_BUDGET_MS = 240_000; // stop starting new tips after 4 min (the schedule allows far more)
export const REC_LANE_LOCK = "earmark:rec-lane"; // pg_try_advisory_xact_lock(hashtext(...))

// Maybes (needs_review) are enriched so the Maybe? row shows art (decision 025); cleared tips never are.
export const SWEEP_SKIPS_STATUSES: readonly RecStatus[] = HIDDEN_TIP_STATUSES.filter((s) => s !== "needs_review");

export const retryDelayMinutes = (attempts: number) => 15 * 4 ** (attempts - 1); // 15 min, 1 h, 4 h, 16 h

// The service is asking us to slow down: stop the whole sweep, don't count it against the tip.
export const isBackOffSignal = (err: unknown) => err instanceof ProviderHttpError && (err.status === 503 || err.status === 429);

export type SweepResult =
  | { status: "locked" }
  | { status: "done"; tried: number; matched: number; noMatch: number; retry: number; gaveUp: number; jevCalls: number;
      stoppedOn: string | null; waitingForKeys: RecType[] };

export interface SweepDeps {
  enrich: typeof enrichRec;
  pick: typeof pickMatch;
  env: Record<string, string | undefined>;
  budgetMs: number;
  onlyIds: readonly number[] | null; // tests: scope the sweep to their own rows
}

/** "Enrich this tip soon": pulls a pending tip to the front of the next sweep. Never calls a provider. */
export async function runRecLane(recId: number): Promise<{ queued: boolean }> {
  const rows = await db()`update recommendations set enrich_next_at = now()
    where id = ${recId} and enrichment_status = 'pending' returning id`;
  return { queued: rows.length > 0 };
}

export async function sweepRecLane(deps: Partial<SweepDeps> = {}): Promise<SweepResult> {
  const d: SweepDeps = { enrich: enrichRec, pick: pickMatch, env: process.env, budgetMs: SWEEP_BUDGET_MS, onlyIds: null, ...deps };
  // A transaction-scoped lock on a dedicated connection: released on commit/rollback or when the connection drops
  // (a killed function never leaves it held). Session locks would leak through Neon's pooled (PgBouncer) endpoint.
  const pool = new Pool({ connectionString: getEnv().DATABASE_URL });
  const c = await pool.connect();
  try {
    return await inTransaction(c, false, async () => {
      const { rows } = await c.query("select pg_try_advisory_xact_lock(hashtext($1)) as got", [REC_LANE_LOCK]);
      return { value: rows[0]?.got ? await sweepLocked(d) : { status: "locked" as const }, commit: false };
    });
  } finally {
    c.release();
    await pool.end();
  }
}

async function sweepLocked(d: SweepDeps): Promise<SweepResult> {
  const started = Date.now();
  const types = enabledTypes(d.env);
  const waitingForKeys = REC_TYPES.filter((t) => !types.includes(t));
  if (waitingForKeys.length) console.log(`[rec-lane] waiting for provider keys: ${waitingForKeys.join(",")}`);

  const due = (await db()`
    select id, type, canonical_name, creator, excerpt, lat, lng, enrich_attempts
    from recommendations
    where enrichment_status = 'pending' and enrich_next_at <= now()
      and status <> all(${SWEEP_SKIPS_STATUSES}::text[]) and type = any(${types}::text[])
      and (${d.onlyIds}::bigint[] is null or id = any(${d.onlyIds}::bigint[]))
    order by enrich_next_at, id
    limit ${MAX_RECS_PER_RUN}`) as (RecToEnrich & { enrich_attempts: number })[];

  const r = { status: "done" as const, tried: 0, matched: 0, noMatch: 0, retry: 0, gaveUp: 0, jevCalls: 0, stoppedOn: null as string | null, waitingForKeys };
  const countedPick: typeof pickMatch = (input, candidates, opts) => {
    if (candidates.length > 0) r.jevCalls++;
    return d.pick(input, candidates, opts);
  };

  for (const row of due) {
    if (r.jevCalls >= MAX_JEV_CALLS_PER_RUN || Date.now() - started > d.budgetMs) break;
    const rec = { ...row, id: Number(row.id) }; // bigserial arrives as a string
    r.tried++;
    try {
      const match = await d.enrich(rec, { env: d.env, pick: countedPick });
      await (match ? saveMatch(rec.id, match) : saveNoMatch(rec.id));
      r[match ? "matched" : "noMatch"]++;
      // Seams, in this order, inside this lock and these caps:
      // - M3-T5: context summary + embedding. Embed with recEmbedText (agent/lib/recs/embed-text.ts, lane B's PR
      //   m4-links); do not add a second embed recipe here.
      // - TODO(M3-T1): push the tip to Notion (pushRecToNotion). Notion isn't built; this step is a no-op until then.
    } catch (err) {
      logEnrichError("rec-lane", { rec: rec.id }, err);
      if (isBackOffSignal(err)) {
        r.stoppedOn = `${(err as ProviderHttpError).host} ${(err as ProviderHttpError).status}`;
        break;
      }
      const gaveUp = await saveFailure(rec.id, Number(row.enrich_attempts) + 1);
      r[gaveUp ? "gaveUp" : "retry"]++;
    }
  }
  return r;
}

// Only while still pending and not cleared (Tarik may dismiss a tip mid-sweep). The provider's name and creator
// replace what Bee heard (mishearing correction, decision 012); a capture's own photo and links win over the provider's.
async function saveMatch(id: number, m: EnrichmentMatch): Promise<void> {
  await db()`
    update recommendations set
      canonical_name = ${m.canonicalName}, creator = coalesce(${m.creator}, creator),
      year_or_address = coalesce(${m.yearOrAddress}, year_or_address), image_url = coalesce(image_url, ${m.imageUrl}),
      links = ${JSON.stringify(m.links)}::jsonb || links, apple_music_id = coalesce(apple_music_id, ${m.appleMusicId ?? null}),
      lat = coalesce(${m.lat ?? null}::float8, lat), lng = coalesce(${m.lng ?? null}::float8, lng),
      enrichment_status = 'matched', enriched_at = now(), updated_at = now()
    where id = ${id} and enrichment_status = 'pending' and status <> all(${SWEEP_SKIPS_STATUSES}::text[])`;
}

async function saveNoMatch(id: number): Promise<void> {
  await db()`update recommendations set enrichment_status = 'no_match', enriched_at = now()
    where id = ${id} and enrichment_status = 'pending'`;
}

/** Returns true when this was the last allowed attempt. */
async function saveFailure(id: number, attempts: number): Promise<boolean> {
  const gaveUp = attempts >= MAX_ATTEMPTS;
  await db()`update recommendations set enrich_attempts = ${attempts},
      enrichment_status = ${gaveUp ? "failed" : "pending"},
      enrich_next_at = now() + make_interval(mins => ${gaveUp ? 0 : retryDelayMinutes(attempts)})
    where id = ${id} and enrichment_status = 'pending'`;
  return gaveUp;
}
