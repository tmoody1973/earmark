// The rec lane (M3-T4, decision 013): every tip waits as enrichment_status = 'pending' until the cron sweep looks it
// up. Providers (MusicBrainz above all, decision 012) are called ONLY from sweepRecLane: one tip at a time, under a
// lease so sweeps never overlap, bounded per run, stopping on the first 503/429.
// Everything else calls runRecLane(id), which never calls a provider.
import { randomUUID } from "node:crypto";
import { createBeeClient } from "../bee/client";
import { db } from "../db";
import { fetchAbout, type About, type AboutRec } from "../enrich/about";
import { enrichRec, type RecToEnrich } from "../enrich/enrich";
import { pickMatch } from "../enrich/match";
import { coverArtUrl } from "../enrich/musicbrainz";
import { enabledTypes, REC_TYPES } from "../enrich/registry";
import { logEnrichError, ProviderHttpError, type EnrichmentMatch } from "../enrich/types";
import { HIDDEN_TIP_STATUSES } from "../garden/queries";
import { ensureRecEmbeddings } from "../links/candidates";
import { CLAIM_LEASE } from "../store/conversations";
import type { RecStatus, RecType } from "../types";
import { conversationSummary, writeContextSummary, type SummaryInput } from "./summary";

export const MAX_RECS_PER_RUN = 10;
export const MAX_JEV_CALLS_PER_RUN = 8; // ≤1 Jev call per tip; tips with no candidates cost none
export const MAX_ATTEMPTS = 5; // failures (not 503s, not second looks' own no_match) → then 'failed'
export const SWEEP_BUDGET_MS = 240_000; // stop starting new tips after 4 min, far inside the 15-min lease
export const BUSY_RETRY_MINUTES = 15; // a 503/429 sends that tip to the back for this long, attempt not counted
export const BUSY_GIVE_UP_DAYS = 7; // …unless it has been pending (pending_since) longer than this: then it's 'failed'
export const SECOND_LOOK_MINUTES = 60;
export const MAX_ART_RETRIES_PER_RUN = 3;
export const MAX_ART_TRIES = 3;
export const REC_LANE_LEASE = "rec_lane_lease"; // sync_cursors row: cursor = the holder's token
// M3-T5. The why has its own cap, apart from Jev's: <=1 model call per tip, ever (summarized_at), so at most 60 an hour
// while a backlog lasts and none once it's gone. Embeddings: one embedMany call per run (recEmbedText, 30 s timeout).
export const MAX_SUMMARIES_PER_RUN = 10;
export const MAX_SUMMARY_FAILURES_IN_A_ROW = 3; // the gateway is down: stop asking until the next run
export const MAX_SUMMARY_ATTEMPTS = 3; // a tip whose call fails 3 times is done: summarized_at set, why null
export const MAX_EMBEDS_PER_RUN = 20;
// M3-T4b. The Wikipedia note: <=10 tips a run, 2 keyless requests each (search, summary), once per tip (about_at).
export const MAX_ABOUTS_PER_RUN = 10;

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
      jevCalls: number; artFixed: number; abouts: number; summarized: number; summaryFailed: number; embedded: number;
      stoppedOn: string | null; waitingForKeys: RecType[] };
type Done = Extract<SweepResult, { status: "done" }>;

export interface SweepDeps {
  enrich: typeof enrichRec;
  pick: typeof pickMatch;
  coverArt: (releaseGroupId: string) => Promise<string | null>;
  summarize: (input: SummaryInput) => Promise<string | null>;
  beeSummary: (conversationId: number) => Promise<string | null>;
  embedRecs: (limit: number) => Promise<number>;
  about: (rec: AboutRec) => Promise<About | null>;
  env: Record<string, string | undefined>;
  budgetMs: number;
  onlyIds: readonly number[] | null; // tests: scope the sweep to their own rows
}

/** "Enrich this tip soon": pulls a pending tip to the front of the next sweep. Never calls a provider. */
export async function runRecLane(recId: number): Promise<{ queued: boolean }> {
  const rows = await db()`update recommendations set enrich_next_at = now(), pending_since = now()
    where id = ${recId} and enrichment_status = 'pending' returning id`;
  return { queued: rows.length > 0 };
}

export async function sweepRecLane(deps: Partial<SweepDeps> = {}): Promise<SweepResult> {
  const d: SweepDeps = { enrich: enrichRec, pick: pickMatch, coverArt: (rg) => coverArtUrl(rg), env: process.env,
    summarize: (input) => writeContextSummary(input),
    beeSummary: async (id) => conversationSummary(await createBeeClient().getConversation(id)),
    embedRecs: (limit) => ensureRecEmbeddings(limit), about: (rec) => fetchAbout(rec),
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

  const r: Done = { status: "done", tried: 0, matched: 0, noMatch: 0, secondLook: 0, retry: 0, gaveUp: 0, jevCalls: 0, artFixed: 0, abouts: 0,
    summarized: 0, summaryFailed: 0, embedded: 0, stoppedOn: null, waitingForKeys };
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
        await db()`update recommendations set enrich_attempts = 1, pending_since = now(),
            enrich_next_at = now() + make_interval(mins => ${SECOND_LOOK_MINUTES})
          where id = ${id} and enrichment_status = 'pending'`;
        r.secondLook++;
        continue;
      } else {
        await db()`update recommendations set enrichment_status = 'no_match', enriched_at = now()
          where id = ${id} and enrichment_status = 'pending'`;
        r.noMatch++;
      }
      // Seams, in this order, inside this lease and these caps (the why and the embedding run after this loop):
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
  if (!overBudget()) {
    try {
      await writeAbouts(d, r, overBudget);
    } catch (err) {
      logEnrichError("rec-lane abouts", {}, err); // the why and embed steps below still run
    }
  }
  if (!overBudget()) {
    try {
      await writeWhys(d, r, overBudget);
    } catch (err) {
      logEnrichError("rec-lane whys", {}, err); // the embed step below still runs
    }
  }
  if (!overBudget()) {
    try {
      r.embedded = await d.embedRecs(MAX_EMBEDS_PER_RUN); // what the whys above just changed, plus any backlog
    } catch (err) {
      logEnrichError("rec-lane embed", {}, err);
    }
  }
  return r;
}

// The why (M3-T5): each visible tip or maybe is asked once (summarized_at), newest visible first, maybes last. The
// excerpt is the source; Bee's conversation summary is context, and Bee being down only drops that context. A changed
// why drops the embedding, so the embed step above writes it again from the new text (recEmbedText includes the why).
// Least-tried first, so a tip whose call keeps failing goes to the back and never blocks the rest; after
// MAX_SUMMARY_ATTEMPTS failures it is done with no why.
async function writeWhys(d: SweepDeps, r: Done, overBudget: () => boolean): Promise<void> {
  const rows = await db()`
    select r.id, r.canonical_name, r.excerpt, r.bee_conversation_id, p.first_name
    from recommendations r left join recommenders p on p.id = r.recommender_id
    where r.summarized_at is null and r.status <> all(${SWEEP_SKIPS_STATUSES}::text[])
      and (${d.onlyIds}::bigint[] is null or r.id = any(${d.onlyIds}::bigint[]))
    order by r.summary_attempts, r.status = 'needs_review', r.id desc
    limit ${MAX_SUMMARIES_PER_RUN}`;
  let failuresInARow = 0;
  for (const row of rows) {
    if (overBudget() || failuresInARow >= MAX_SUMMARY_FAILURES_IN_A_ROW) break;
    const id = Number(row.id);
    const conversationId = row.bee_conversation_id === null ? null : Number(row.bee_conversation_id);
    const beeSummary = conversationId === null ? null : await d.beeSummary(conversationId).catch((err: unknown) => {
      logEnrichError("rec-lane bee summary", { rec: id }, err);
      return null;
    });
    try {
      const why = await d.summarize({ name: row.canonical_name, excerpt: row.excerpt, beeSummary, recommender: row.first_name });
      await db()`update recommendations set
          embedding = case when context_summary is distinct from ${why} then null else embedding end,
          context_summary = ${why}, summarized_at = now(), updated_at = now()
        where id = ${id} and summarized_at is null`;
      r.summarized++;
      failuresInARow = 0;
    } catch (err) {
      logEnrichError("rec-lane summary", { rec: id }, err);
      r.summaryFailed++;
      await db()`update recommendations set summary_attempts = summary_attempts + 1,
          summarized_at = case when summary_attempts + 1 >= ${MAX_SUMMARY_ATTEMPTS} then now() end
        where id = ${id} and summarized_at is null`;
      failuresInARow++;
    }
  }
}

// The Wikipedia note (M3-T4b, decision 017): matched, visible tips (maybes too), each looked up once, newest first.
// One try: found, unsure or failed, about_at is set and the tip is never asked again. A 503/429 stops this step for
// the run and leaves the rest for the next one. No model call.
async function writeAbouts(d: SweepDeps, r: Done, overBudget: () => boolean): Promise<void> {
  const rows = (await db()`
    select id, type, canonical_name, creator from recommendations
    where enrichment_status = 'matched' and about_at is null and status <> all(${SWEEP_SKIPS_STATUSES}::text[])
      and (${d.onlyIds}::bigint[] is null or id = any(${d.onlyIds}::bigint[]))
    order by id desc limit ${MAX_ABOUTS_PER_RUN}`) as (AboutRec & { id: number | string })[];
  for (const row of rows) {
    if (overBudget()) break;
    const id = Number(row.id);
    let about: About | null = null;
    let busy = false;
    try {
      about = await d.about({ type: row.type, canonical_name: row.canonical_name, creator: row.creator });
    } catch (err) {
      logEnrichError("rec-lane about", { rec: id }, err);
      busy = isBackOffSignal(err);
    }
    await db()`update recommendations set about = ${about?.text ?? null}, about_url = ${about?.url ?? null}, about_at = now()
      where id = ${id} and about_at is null`;
    if (about) r.abouts++;
    if (busy) break;
  }
}

// Only while still pending and not cleared (Tarik may dismiss a tip mid-sweep). The provider's name and creator
// replace what Bee heard (mishearing correction, decision 012); a capture's own photo and links win over the provider's.
// recEmbedText reads name and creator, so a change drops the embedding and the sweep's embed step writes it again.
// A match whose art lookup errored and that has no picture yet is marked for the art-only retry tail.
async function saveMatch(id: number, m: EnrichmentMatch): Promise<void> {
  await db()`
    update recommendations set
      embedding = case when canonical_name is distinct from ${m.canonicalName}
        or creator is distinct from coalesce(${m.creator}, creator) then null else embedding end,
      canonical_name = ${m.canonicalName}, creator = coalesce(${m.creator}, creator),
      year_or_address = coalesce(${m.yearOrAddress}, year_or_address), image_url = coalesce(image_url, ${m.imageUrl}),
      links = ${JSON.stringify(m.links)}::jsonb || links, apple_music_id = coalesce(apple_music_id, ${m.appleMusicId ?? null}),
      lat = coalesce(${m.lat ?? null}::float8, lat), lng = coalesce(${m.lng ?? null}::float8, lng),
      art_retry_mbid = case when coalesce(image_url, ${m.imageUrl}) is null then ${m.artRetry ?? null} end,
      enrichment_status = 'matched', enriched_at = now(), updated_at = now()
    where id = ${id} and enrichment_status = 'pending' and status <> all(${SWEEP_SKIPS_STATUSES}::text[])`;
}

// 503/429: to the back of the line without an attempt, so one busy service never pins the queue; a tip pending for
// over a week gives up.
async function saveBusy(id: number): Promise<void> {
  await db()`update recommendations set enrich_next_at = now() + make_interval(mins => ${BUSY_RETRY_MINUTES}),
      enrichment_status = case when pending_since < now() - make_interval(days => ${BUSY_GIVE_UP_DAYS}) then 'failed' else 'pending' end
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

// Final outcomes only (matched, final no_match, failed): a still-pending tip keeps whatever reason it has. A final
// outcome recomputes from scratch, so it replaces an earlier reason (no_recommender → no_match).
async function applyReviewReason(id: number): Promise<void> {
  const [row] = await db()`select status, review_reason, recommender_id, enrichment_status from recommendations where id = ${id}`;
  if (!row || row.enrichment_status === "pending") return; // forgotten mid-sweep, or not final yet
  const reason = reviewReasonFor({ ...(row as Parameters<typeof reviewReasonFor>[0]), review_reason: null });
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
