// The rec lane (M3-T4, decision 013): every tip waits as enrichment_status = 'pending' until the cron sweep looks it
// up. Providers (MusicBrainz above all, decision 012) are called ONLY from sweepRecLane: one tip at a time, under a
// lease so sweeps never overlap, bounded per run, stopping on the first 503/429.
// Everything else calls runRecLane(id), which never calls a provider.
import { randomUUID } from "node:crypto";
import { db } from "../db";
import { enrichRec, type RecToEnrich } from "../enrich/enrich";
import { pickMatch } from "../enrich/match";
import { coverArtUrl } from "../enrich/musicbrainz";
import { enabledTypes, REC_TYPES } from "../enrich/registry";
import { logEnrichError, ProviderHttpError, type EnrichmentMatch } from "../enrich/types";
import { HIDDEN_TIP_STATUSES } from "../garden/queries";
import { CLAIM_LEASE } from "../store/conversations";
import type { RecStatus, RecType } from "../types";

export const MAX_RECS_PER_RUN = 10;
export const MAX_JEV_CALLS_PER_RUN = 8; // ≤1 Jev call per tip; tips with no candidates cost none
export const MAX_ATTEMPTS = 5; // failures (not 503s, not second looks' own no_match) → then 'failed'
export const SWEEP_BUDGET_MS = 240_000; // stop starting new tips after 4 min, far inside the 15-min lease
export const BUSY_RETRY_MINUTES = 15; // a 503/429 sends that tip to the back for this long, attempt not counted
export const BUSY_GIVE_UP_DAYS = 7; // …unless the tip is older than this: then it's 'failed'
export const SECOND_LOOK_MINUTES = 60;
export const MAX_ART_RETRIES_PER_RUN = 3;
export const MAX_ART_TRIES = 3;
export const REC_LANE_LEASE = "rec_lane_lease"; // sync_cursors row: cursor = the holder's token

// Maybes (needs_review) are enriched so the Maybe? row shows art (decision 025); cleared tips never are.
export const SWEEP_SKIPS_STATUSES: readonly RecStatus[] = HIDDEN_TIP_STATUSES.filter((s) => s !== "needs_review");

export type EnrichmentStatus = "pending" | "matched" | "no_match" | "failed";
export type ReviewReason = "confidence_band" | "no_recommender" | "no_match" | null;

export const retryDelayMinutes = (attempts: number) => 15 * 4 ** (attempts - 1); // 15 min, 1 h, 4 h, 16 h

// The service is asking us to slow down: stop the whole sweep, don't count it against the tip.
export const isBackOffSignal = (err: unknown) => err instanceof ProviderHttpError && (err.status === 503 || err.status === 429);

/** Why a tip needs Tarik's eye, if it does (M3-T9's Slack cards read review_reason). Pure. */
export function reviewReasonFor(rec: {
  status: RecStatus; review_reason: ReviewReason; recommender_id: number | string | null; enrichment_status: EnrichmentStatus;
}): ReviewReason {
  if (rec.status === "dismissed" || rec.status === "composted") return null;
  if (rec.review_reason) return rec.review_reason;
  if (rec.status === "needs_review") return "confidence_band";
  if (rec.enrichment_status === "no_match") return "no_match";
  if (rec.recommender_id === null) return "no_recommender";
  return null;
}

export type SweepResult =
  | { status: "locked" }
  | { status: "done"; tried: number; matched: number; noMatch: number; secondLook: number; retry: number; gaveUp: number;
      jevCalls: number; artFixed: number; stoppedOn: string | null; waitingForKeys: RecType[] };
type Done = Extract<SweepResult, { status: "done" }>;

export interface SweepDeps {
  enrich: typeof enrichRec;
  pick: typeof pickMatch;
  coverArt: (releaseGroupId: string) => Promise<string | null>;
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
  const d: SweepDeps = { enrich: enrichRec, pick: pickMatch, coverArt: (rg) => coverArtUrl(rg), env: process.env,
    budgetMs: SWEEP_BUDGET_MS, onlyIds: null, ...deps };
  // The repo's lease pattern (cf. claimDraftableClusters): one conditional upsert takes the lease if it's free or
  // older than CLAIM_LEASE (a crashed run); release only while our token still holds it.
  const token = randomUUID();
  const took = await db()`
    insert into sync_cursors (name, cursor) values (${REC_LANE_LEASE}, ${token})
    on conflict (name) do update set cursor = excluded.cursor, updated_at = now()
      where sync_cursors.updated_at < now() - ${CLAIM_LEASE}::interval
    returning cursor`;
  if (took.length === 0) return { status: "locked" };
  try {
    return await sweepLeased(d);
  } finally {
    await db()`delete from sync_cursors where name = ${REC_LANE_LEASE} and cursor = ${token}`;
  }
}

async function sweepLeased(d: SweepDeps): Promise<Done> {
  const started = Date.now();
  const overBudget = () => Date.now() - started > d.budgetMs;
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

  const r: Done = { status: "done", tried: 0, matched: 0, noMatch: 0, secondLook: 0, retry: 0, gaveUp: 0, jevCalls: 0, artFixed: 0,
    stoppedOn: null, waitingForKeys };
  const countedPick: typeof pickMatch = (input, candidates, opts) => {
    if (candidates.length > 0) r.jevCalls++;
    return d.pick(input, candidates, opts);
  };

  for (const row of due) {
    if (r.jevCalls >= MAX_JEV_CALLS_PER_RUN || overBudget()) break;
    const id = Number(row.id); // bigserial arrives as a string
    const attempts = Number(row.enrich_attempts);
    r.tried++;
    try {
      const jevBefore = r.jevCalls;
      const match = await d.enrich({ ...row, id }, { env: d.env, pick: countedPick });
      if (match) {
        await saveMatch(id, match);
        r.matched++;
      } else if (r.jevCalls > jevBefore && attempts === 0) {
        // Jev saw candidates and said none fits: one more look later (a flaky near-0.8 call, rec 160). The second
        // no_match is final. ponytail: "first look" = no attempts yet, so a tip that errored earlier gets no second look.
        await db()`update recommendations set enrich_attempts = 1,
            enrich_next_at = now() + make_interval(mins => ${SECOND_LOOK_MINUTES})
          where id = ${id} and enrichment_status = 'pending'`;
        r.secondLook++;
        continue;
      } else {
        await db()`update recommendations set enrichment_status = 'no_match', enriched_at = now()
          where id = ${id} and enrichment_status = 'pending'`;
        r.noMatch++;
      }
      // Seams, in this order, inside this lease and these caps:
      // - M3-T5: context summary + embedding. Embed with recEmbedText (agent/lib/recs/embed-text.ts, lane B's PR
      //   m4-links); do not add a second embed recipe here.
      // - TODO(M3-T1): push the tip to Notion (pushRecToNotion). Notion isn't built; this step is a no-op until then.
    } catch (err) {
      logEnrichError("rec-lane", { rec: id }, err);
      if (isBackOffSignal(err)) {
        r.stoppedOn = `${(err as ProviderHttpError).host} ${(err as ProviderHttpError).status}`;
        await saveBusy(id);
        await applyReviewReason(id);
        break;
      }
      const gaveUp = await saveFailure(id, attempts + 1);
      r[gaveUp ? "gaveUp" : "retry"]++;
    }
    await applyReviewReason(id);
  }
  if (!overBudget()) await retryArt(d, r);
  return r;
}

// Only while still pending and not cleared (Tarik may dismiss a tip mid-sweep). The provider's name and creator
// replace what Bee heard (mishearing correction, decision 012); a capture's own photo and links win over the provider's.
// A match whose art lookup errored and that has no picture yet is marked for the art-only retry tail.
async function saveMatch(id: number, m: EnrichmentMatch): Promise<void> {
  await db()`
    update recommendations set
      canonical_name = ${m.canonicalName}, creator = coalesce(${m.creator}, creator),
      year_or_address = coalesce(${m.yearOrAddress}, year_or_address), image_url = coalesce(image_url, ${m.imageUrl}),
      links = ${JSON.stringify(m.links)}::jsonb || links, apple_music_id = coalesce(apple_music_id, ${m.appleMusicId ?? null}),
      lat = coalesce(${m.lat ?? null}::float8, lat), lng = coalesce(${m.lng ?? null}::float8, lng),
      art_retry_mbid = case when coalesce(image_url, ${m.imageUrl}) is null then ${m.artRetry ?? null} end,
      enrichment_status = 'matched', enriched_at = now(), updated_at = now()
    where id = ${id} and enrichment_status = 'pending' and status <> all(${SWEEP_SKIPS_STATUSES}::text[])`;
}

// 503/429: to the back of the line without an attempt, so one busy service never pins the queue; a week-old tip gives up.
async function saveBusy(id: number): Promise<void> {
  await db()`update recommendations set enrich_next_at = now() + make_interval(mins => ${BUSY_RETRY_MINUTES}),
      enrichment_status = case when created_at < now() - make_interval(days => ${BUSY_GIVE_UP_DAYS}) then 'failed' else 'pending' end
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

async function applyReviewReason(id: number): Promise<void> {
  const [row] = await db()`select status, review_reason, recommender_id, enrichment_status from recommendations where id = ${id}`;
  if (!row) return; // forgotten mid-sweep
  const reason = reviewReasonFor(row as Parameters<typeof reviewReasonFor>[0]);
  if (reason !== row.review_reason) await db()`update recommendations set review_reason = ${reason} where id = ${id}`;
}

// Tail: Cover Art Archive only (no MusicBrainz, no Jev) for matches whose art lookup errored. Cleared on an answer
// (art, or a definite "no art") or after MAX_ART_TRIES errors.
async function retryArt(d: SweepDeps, r: Done): Promise<void> {
  const rows = await db()`
    select id, art_retry_mbid, art_retries from recommendations
    where art_retry_mbid is not null and status <> all(${SWEEP_SKIPS_STATUSES}::text[])
      and (${d.onlyIds}::bigint[] is null or id = any(${d.onlyIds}::bigint[]))
    order by id limit ${MAX_ART_RETRIES_PER_RUN}`;
  for (const row of rows) {
    const id = Number(row.id);
    const tries = Number(row.art_retries) + 1;
    try {
      const url = await d.coverArt(String(row.art_retry_mbid));
      await db()`update recommendations set image_url = coalesce(image_url, ${url}), art_retry_mbid = null, art_retries = ${tries}
        where id = ${id}`;
      if (url) r.artFixed++;
    } catch (err) {
      logEnrichError("art-retry", { rec: id, mbid: String(row.art_retry_mbid) }, err);
      await db()`update recommendations set art_retries = ${tries},
          art_retry_mbid = ${tries >= MAX_ART_TRIES ? null : String(row.art_retry_mbid)}
        where id = ${id}`;
    }
  }
}
