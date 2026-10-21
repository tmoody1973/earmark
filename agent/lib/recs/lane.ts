// The rec lane (M3-T4, decision 013): every tip waits as enrichment_status = 'pending' until the cron sweep looks it
// up. Providers (MusicBrainz above all, decision 012) are called ONLY from sweepRecLane: one tip at a time, under a
// lease so sweeps never overlap, bounded per run, stopping on the first 503/429.
// Everything else calls runRecLane(id), which never calls a provider.
import { randomUUID } from "node:crypto";
import { createBeeClient } from "../bee/client";
import { db } from "../db";
import { biasFor } from "../enrich/bias";
import { ownerFirstName } from "../env";
import { fetchAbout, type About, type AboutRec } from "../enrich/about";
import { enrichRec, type RecToEnrich } from "../enrich/enrich";
import { discogsAccess } from "../enrich/discogs";
import { fetchExtras, type ExtrasRec, type RecExtras } from "../enrich/extras";
import { MATCH_ACCEPT, pickMatch } from "../enrich/match";
import { coverArtUrl } from "../enrich/musicbrainz";
import { enabledTypes, providerFor, REC_TYPES } from "../enrich/registry";
import { describeCandidate, logEnrichError, MAX_CANDIDATES, ProviderHttpError, type Candidate, type EnrichmentMatch } from "../enrich/types";
import { HIDDEN_TIP_STATUSES } from "../garden/queries";
import { candidateKey, readCandidates, type StoredCandidate } from "../garden/which-one";
import { ensureRecEmbeddings } from "../links/candidates";
import { CLAIM_LEASE } from "../store/conversations";
import type { RecStatus, RecType } from "../types";
import { conversationSummary, writeContextSummary, type SummaryInput } from "./summary";
import { findOnWeb, WEB_FIND_TYPES, type WebFound, type WebTip } from "./web-find";

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
// M3-T4b. The Wikipedia note: <=10 tips a run, 2 keyless requests each (search, summary; music adds one Wikidata ASK).
export const MAX_ABOUTS_PER_RUN = 10;
export const MAX_ABOUT_TRIES = 3; // errors/timeouts (not 503/429): then done, no note
// Decision 045. The tip page's extras: <=10 tips a run, 0-3 keyless requests each (iTunes, a feed, Open Library, Wikipedia).
export const MAX_EXTRAS_PER_RUN = 10;
export const MAX_EXTRAS_TRIES = 3; // errors/timeouts (not 503/429): then the lane stops asking (extras_at stays null)
// Decision 051. Find it on the web: <=3 tips a run, each 1 TinyFish Search (free) + <=1 EXTRACT_MODEL call + <=3 catalog
// searches with the web's titles. Never Jev. Once per tip (web_looked_at), only while TINYFISH_API_KEY is set.
export const MAX_WEB_FINDS_PER_RUN = 3;

// Maybes (needs_review) are enriched so the Maybe? row shows art (decision 025); cleared and overheard tips never are.
export const SWEEP_SKIPS_STATUSES: readonly RecStatus[] = HIDDEN_TIP_STATUSES.filter((s) => s !== "needs_review");

export type EnrichmentStatus = "pending" | "matched" | "no_match" | "failed";
export type ReviewReason = "confidence_band" | "no_recommender" | "no_match" | null;

export const retryDelayMinutes = (attempts: number) => 15 * 4 ** (attempts - 1); // 15 min, 1 h, 4 h, 16 h

// The service is asking us to slow down: stop the whole sweep, don't count it against the tip.
// iTunes Search can say it with a 403 too (its ~20 calls/minute limit); anywhere else a 403 is a real refusal.
export const isBackOffSignal = (err: unknown) => err instanceof ProviderHttpError
  && (err.status === 503 || err.status === 429 || (err.status === 403 && err.host === "itunes.apple.com"));

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
      jevCalls: number; artFixed: number; abouts: number; extras: number; summarized: number; summaryFailed: number; embedded: number;
      webFinds: number; webMatched: number; stoppedOn: string | null; waitingForKeys: RecType[] };
type Done = Extract<SweepResult, { status: "done" }>;

export interface SweepDeps {
  enrich: typeof enrichRec;
  pick: typeof pickMatch;
  coverArt: (releaseGroupId: string) => Promise<string | null>;
  summarize: (input: SummaryInput) => Promise<string | null>;
  beeSummary: (conversationId: number) => Promise<string | null>;
  embedRecs: (limit: number) => Promise<number>;
  about: (rec: AboutRec) => Promise<About | null>;
  extras: (rec: ExtrasRec) => Promise<RecExtras>;
  webFind: (tip: WebTip) => Promise<WebFound>;
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
    extras: (rec) => fetchExtras(rec, fetch, discogsAccess(deps.env ?? process.env), (deps.env ?? process.env).TMDB_API_KEY?.trim() || null),
    webFind: (tip) => findOnWeb(tip, { env: deps.env ?? process.env, fetchImpl: fetch }),
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

  // pendingKey: when this tip (re)entered the queue, as text (exact to the microsecond). Every write below for the tip
  // lands only while it is unchanged, so an owner's fix made mid-lookup (decision 049 re-queues with new words) is never
  // overwritten by what the old words found.
  const due = (await db()`
    select id, type, canonical_name, creator, excerpt, lat, lng, said_lat as "saidLat", said_lng as "saidLng", links, enrich_attempts,
      pending_since::text as "pendingKey"
    from recommendations
    where enrichment_status = 'pending' and enrich_next_at <= now() and match_source = 'auto'
      and status <> all(${SWEEP_SKIPS_STATUSES}::text[]) and type = any(${types}::text[])
      and (${d.onlyIds}::bigint[] is null or id = any(${d.onlyIds}::bigint[]))
    order by enrich_next_at, id
    limit ${MAX_RECS_PER_RUN}`) as (RecToEnrich & { enrich_attempts: number; pendingKey: string })[];

  const r: Done = { status: "done", tried: 0, matched: 0, noMatch: 0, secondLook: 0, retry: 0, gaveUp: 0, jevCalls: 0, artFixed: 0, abouts: 0, extras: 0,
    summarized: 0, summaryFailed: 0, embedded: 0, webFinds: 0, webMatched: 0, stoppedOn: null, waitingForKeys };
  // What Jev was shown and what it chose, for this tip ("Which one?", decision 048). Every provider asks pick once.
  type Seen = { candidates: readonly Candidate[]; picked: EnrichmentMatch | null };
  const last: { seen: Seen | null } = { seen: null };
  const countedPick: typeof pickMatch = async (input, candidates, opts) => {
    if (candidates.length > 0) r.jevCalls++;
    const picked = await d.pick(input, candidates, opts);
    last.seen = { candidates, picked };
    return picked;
  };

  for (const row of due) {
    if (r.jevCalls >= MAX_JEV_CALLS_PER_RUN || overBudget()) break;
    const id = Number(row.id); // bigserial arrives as a string
    const attempts = Number(row.enrich_attempts);
    const pk = row.pendingKey;
    r.tried++;
    last.seen = null;
    try {
      const jevBefore = r.jevCalls;
      const match = await d.enrich({ ...row, id }, { env: d.env, pick: countedPick });
      // Before the outcome's write, so candidates_at <= enriched_at: a later candidates_at means the owner searched.
      const seen = last.seen as Seen | null; // set inside enrich, through countedPick
      if (seen && seen.candidates.length > 0) {
        await saveCandidates(id, providerFor(row.type, d.env)?.name ?? row.type, seen.candidates, seen.picked, pk);
      }
      if (match && match.matchConfidence >= MATCH_ACCEPT) {
        await saveMatch(id, match, { ifPendingSince: pk });
        r.matched++;
      } else if (match) {
        // A link only (a video tip's search link, or a URL oEmbed couldn't confirm): never 'matched' below 0.8. It's
        // no_match, so it reaches review (M3-T9), and the link is kept so the card still opens somewhere.
        await saveLinkOnly(id, match.links, pk);
        r.noMatch++;
      } else if (r.jevCalls > jevBefore && attempts === 0) {
        // Jev saw candidates and said none fits: one more look later (a flaky near-0.8 call, rec 160). The second
        // no_match is final. ponytail: "first look" = no attempts yet, so a tip that errored earlier gets no second look.
        await db()`update recommendations set enrich_attempts = 1, pending_since = now(),
            enrich_next_at = now() + make_interval(mins => ${SECOND_LOOK_MINUTES})
          where id = ${id} and enrichment_status = 'pending' and pending_since = ${pk}::timestamptz`;
        r.secondLook++;
        continue;
      } else {
        await db()`update recommendations set enrichment_status = 'no_match', enriched_at = now()
          where id = ${id} and enrichment_status = 'pending' and pending_since = ${pk}::timestamptz`;
        r.noMatch++;
      }
      // Seams, in this order, inside this lease and these caps (the why and the embedding run after this loop):
      // - TODO(M3-T1): push the tip to Notion (pushRecToNotion). Notion isn't built; this step is a no-op until then.
    } catch (err) {
      logEnrichError("rec-lane", { rec: id }, err);
      if (isBackOffSignal(err)) {
        r.stoppedOn = `${(err as ProviderHttpError).host} ${(err as ProviderHttpError).status}`;
        await saveBusy(id, pk);
        await applyReviewReason(id);
        break;
      }
      const gaveUp = await saveFailure(id, attempts + 1, pk);
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
      await writeExtras(d, r, overBudget);
    } catch (err) {
      logEnrichError("rec-lane extras step", {}, err); // the why and embed steps below still run
    }
  }
  if (!overBudget()) {
    try {
      await writeWhys(d, r, overBudget);
    } catch (err) {
      logEnrichError("rec-lane whys", {}, err); // the embed step below still runs
    }
  }
  // After the whys (its query reads the why), and never while a catalog is asking us to slow down (it searches them too).
  if (!overBudget() && !r.stoppedOn && d.env.TINYFISH_API_KEY?.trim()) {
    try {
      await findOnTheWeb(d, r, overBudget, types);
    } catch (err) {
      logEnrichError("rec-lane web find step", {}, err); // the embed step below still runs
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
// MAX_SUMMARY_ATTEMPTS failures it is done with no why. A why the owner wrote (why_source 'owner', decision 049) is final.
async function writeWhys(d: SweepDeps, r: Done, overBudget: () => boolean): Promise<void> {
  const rows = await db()`
    select r.id, r.canonical_name, r.excerpt, r.bee_conversation_id, p.first_name
    from recommendations r left join recommenders p on p.id = r.recommender_id
    where r.summarized_at is null and r.why_source = 'auto' and r.status <> all(${SWEEP_SKIPS_STATUSES}::text[])
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
        where id = ${id} and summarized_at is null and why_source = 'auto'`;
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

// The Wikipedia note (M3-T4b, decision 017): matched, visible tips (maybes too), least-tried first, then newest.
// A note or "unsure" is final (about_at). A thrown error or timeout counts a try and leaves the tip for the next run;
// MAX_ABOUT_TRIES ends it with no note. A 503/429 changes nothing and stops this step for the run. No model call.
async function writeAbouts(d: SweepDeps, r: Done, overBudget: () => boolean): Promise<void> {
  const rows = (await db()`
    select id, type, canonical_name, creator, year_or_address, links, enriched_at::text as enriched_key from recommendations
    where enrichment_status = 'matched' and about_at is null and status <> all(${SWEEP_SKIPS_STATUSES}::text[])
      and (${d.onlyIds}::bigint[] is null or id = any(${d.onlyIds}::bigint[]))
    order by about_tries, id desc limit ${MAX_ABOUTS_PER_RUN}`) as (AboutRec & { id: number | string; enriched_key: string })[];
  for (const row of rows) {
    if (overBudget()) break;
    const id = Number(row.id);
    try {
      const about = await d.about({ type: row.type, canonical_name: row.canonical_name, creator: row.creator,
        year_or_address: row.year_or_address, links: row.links });
      // enriched_at unchanged: still the item this note is about (an owner's correction moves it; decision 048)
      await db()`update recommendations set about = ${about?.text ?? null}, about_url = ${about?.url ?? null}, about_at = now()
        where id = ${id} and about_at is null and enriched_at is not distinct from ${row.enriched_key}::timestamptz`;
      if (about) r.abouts++;
    } catch (err) {
      logEnrichError("rec-lane about", { rec: id }, err);
      if (isBackOffSignal(err)) break; // the service is busy: not this tip's fault, nothing counted
      await db()`update recommendations set about_tries = about_tries + 1,
          about_at = case when about_tries + 1 >= ${MAX_ABOUT_TRIES} then now() end
        where id = ${id} and about_at is null`;
    }
  }
}

// The tip page's extras (decision 045): matched, visible tips (maybes too) whose about step is done, so a Wikipedia
// about_url is known; least-tried first, then newest. A result, even {} (nothing to add), is final (extras_at). A thrown
// error or timeout counts a try; at MAX_EXTRAS_TRIES the tip is no longer asked. A 503/429 changes nothing and stops
// this step for the run. Never a model call.
async function writeExtras(d: SweepDeps, r: Done, overBudget: () => boolean): Promise<void> {
  const rows = (await db()`
    select id, type, canonical_name, creator, apple_music_id, links, about_url, enriched_at::text as enriched_key from recommendations
    where enrichment_status = 'matched' and about_at is not null and extras_at is null and extras_tries < ${MAX_EXTRAS_TRIES}
      and status <> all(${SWEEP_SKIPS_STATUSES}::text[])
      and (${d.onlyIds}::bigint[] is null or id = any(${d.onlyIds}::bigint[]))
    order by extras_tries, id desc limit ${MAX_EXTRAS_PER_RUN}`) as (ExtrasRec & { id: number | string; enriched_key: string })[];
  for (const row of rows) {
    if (overBudget()) break;
    const id = Number(row.id);
    try {
      const extras = await d.extras({ type: row.type, canonical_name: row.canonical_name, creator: row.creator,
        apple_music_id: row.apple_music_id, links: row.links, about_url: row.about_url });
      // Merged, never replaced (the refresh script may have added extras.discogs already); links.discogs follows it.
      const saved = await db()`update recommendations set extras = coalesce(extras, '{}'::jsonb) || ${JSON.stringify(extras)}::jsonb,
          links = case when ${extras.discogs?.url ?? null}::text is null then links
            else coalesce(links, '{}'::jsonb) || jsonb_build_object('discogs', ${extras.discogs?.url ?? null}::text) end,
          extras_at = now()
        where id = ${id} and extras_at is null and enriched_at is not distinct from ${row.enriched_key}::timestamptz returning id`; // same item (048)
      if (saved.length > 0 && Object.keys(extras).length > 0) r.extras++; // not a tip forgotten mid-run
    } catch (err) {
      logEnrichError("rec-lane extras", { rec: id }, err);
      if (isBackOffSignal(err)) break; // the service is busy: not this tip's fault, nothing counted
      await db()`update recommendations set extras_tries = extras_tries + 1 where id = ${id} and extras_at is null`;
    }
  }
}

// Find it on the web (decision 051): automatic no-matches the web hasn't been asked about, whose why step is done (the
// query reads it) and whose options the owner hasn't searched for (candidates_at later than enriched_at: decision 048's
// rule) unless that search came up empty (decision 060: the agent keeps looking for the owner), newest first. A refusal from TinyFish or a catalog (ProviderHttpError: 402/429/503…) leaves the tip as it was and
// stops this step: the next run asks again. Any other failure (the model, a timeout) ends the tip's one look, so a bad
// answer never costs a call every run. web_looked_at is claimed only while the tip is still the no_match that was read
// (enriched_at unchanged); every write after is guarded the same way.
async function findOnTheWeb(d: SweepDeps, r: Done, overBudget: () => boolean, types: readonly RecType[]): Promise<void> {
  const rows = (await db()`
    select id, type, canonical_name, creator, context_summary, match_candidates, enriched_at::text as enriched_key,
      lat, lng, said_lat, said_lng,
      (select first_name from recommenders p where p.id = recommendations.recommender_id) as recommender_first_name from recommendations
    where enrichment_status = 'no_match' and match_source = 'auto' and web_looked_at is null
      and (summarized_at is not null or why_source = 'owner')
      and (candidates_at is null or candidates_at <= enriched_at or coalesce(match_candidates, '[]'::jsonb) = '[]'::jsonb)
      and status <> all(${SWEEP_SKIPS_STATUSES}::text[]) and type = any(${WEB_FIND_TYPES.filter((t) => types.includes(t))}::text[])
      and (${d.onlyIds}::bigint[] is null or id = any(${d.onlyIds}::bigint[]))
    order by id desc limit ${MAX_WEB_FINDS_PER_RUN}`) as (Omit<WebTip, "id"> & { id: number | string; match_candidates: unknown; enriched_key: string | null; recommender_first_name: string | null;
      lat: number | null; lng: number | null; said_lat: number | null; said_lng: number | null })[];
  for (const row of rows) {
    if (overBudget()) break;
    const id = Number(row.id);
    r.webFinds++;
    let found: WebFound;
    try {
      found = await d.webFind({ id, type: row.type, canonical_name: row.canonical_name, creator: row.creator, context_summary: row.context_summary,
        names: [row.recommender_first_name, ownerFirstName()],
        near: biasFor({ saidLat: row.said_lat, saidLng: row.said_lng, lat: row.lat, lng: row.lng }, d.env) });
    } catch (err) {
      logEnrichError("rec-lane web find", { rec: id }, err);
      if (err instanceof ProviderHttpError) break; // not this tip's answer: it is asked again next run
      found = { kind: "nothing" };
    }
    const claimed = await db()`update recommendations set web_looked_at = now()
      where id = ${id} and web_looked_at is null and enrichment_status = 'no_match' and match_source = 'auto'
        and enriched_at is not distinct from ${row.enriched_key}::timestamptz returning id`;
    if (claimed.length === 0) continue; // the owner (or another tab) changed the tip mid-lookup
    if (found.kind === "match" && await saveMatch(id, found.match, { ifNoMatchAt: row.enriched_key })) {
      r.webMatched++;
      await applyReviewReason(id);
    } else if (found.kind === "options") {
      await saveWebCandidates(id, found.candidates, row.match_candidates, row.enriched_key);
    }
  }
}

// The web's options first, then what the catalogs offered before (Jev turned those down), at most MAX_CANDIDATES.
// candidates_at and enriched_at move together (one now()), so "a later candidates_at means the owner searched" still holds.
async function saveWebCandidates(id: number, found: readonly StoredCandidate[], before: unknown, enrichedKey: string | null): Promise<void> {
  const all = [...found, ...readCandidates(before)];
  const stored = all.filter((c, i) => all.findIndex((o) => candidateKey(o) === candidateKey(c)) === i).slice(0, MAX_CANDIDATES);
  await db()`update recommendations set match_candidates = ${JSON.stringify(stored)}::jsonb, candidates_at = now(), enriched_at = now(), updated_at = now()
    where id = ${id} and enrichment_status = 'no_match' and match_source = 'auto' and enriched_at is not distinct from ${enrichedKey}::timestamptz`;
}

// Which links a provider supplied (types.ts RecLinks), as opposed to a capture's own (url, urls, youtube, primary).
export const PROVIDER_LINK_KEYS = ["apple_music", "musicbrainz", "discogs", "openlibrary", "wikipedia", "tmdb", "google_maps",
  "openstreetmap", "podcast_index", "apple_podcasts"];
// What each capture brought itself, which a correction keeps: a shared song its Apple Music id and link (capture/songs.ts),
// a photo its picture (photos.ts). An email capture (email.ts) and a heard tip bring neither.
export const SONG_CAPTURE_STRIPS = PROVIDER_LINK_KEYS.filter((k) => k !== "apple_music");

// The one save path for a match, the lane's and the owner's ("Which one?", decision 048). Never a cleared tip, never one
// the owner already settled (match_source 'owner' is final).
// Automatic (the lane): only while still pending (Tarik may dismiss a tip mid-sweep). The provider's name and creator
// replace what Bee heard (mishearing correction, decision 012); a capture's own photo and links win over the provider's.
// The owner's pick (ownerPick = its candidateKey; ifCandidates = the list it was picked from, so a list replaced since
// refuses the write): any state. When it corrects an earlier match ("fix"), that match's creator, art, provider links,
// Apple id, year/address and (for a place) location go with it, except what the capture itself brought (a song's Apple
// id and link, a photo's picture), kept unless the pick brings its own. The Wikipedia note and the extras are reset so the lane refills them for the new
// item; auto_pick is kept, so "did Jev agree?" stays answerable. enriched_at moves, which the lane's tail writes check.
// recEmbedText reads name and creator, so a change drops the embedding and the sweep's embed step writes it again.
// A match whose art lookup errored (or a music pick with no art yet) and that has no picture is marked for the art-only
// retry tail. ifPendingSince: the lane's read token (see sweepLeased). ifNoMatchAt: the web find's (decision 051), an
// automatic no_match whose enriched_at is still this. Returns whether the row changed.
export async function saveMatch(
  id: number, m: EnrichmentMatch,
  opts: { ownerPick?: string; ifCandidates?: string; ifPendingSince?: string; ifNoMatchAt?: string | null } = {},
): Promise<boolean> {
  const owner = opts.ownerPick !== undefined;
  const web = opts.ifNoMatchAt !== undefined;
  const lat = m.lat ?? null;
  const lng = m.lng ?? null;
  const img = m.imageUrl;
  const apple = m.appleMusicId ?? null;
  const rows = await db()`
    update recommendations r set
      embedding = case when r.canonical_name is distinct from ${m.canonicalName}
        or r.creator is distinct from (case when f.fix then ${m.creator} else coalesce(${m.creator}, r.creator) end) then null else r.embedding end,
      canonical_name = ${m.canonicalName},
      creator = case when f.fix then ${m.creator} else coalesce(${m.creator}, r.creator) end,
      year_or_address = case when f.fix then ${m.yearOrAddress} else coalesce(${m.yearOrAddress}, r.year_or_address) end,
      image_url = case when f.fix and f.photo then coalesce(${img}, r.image_url) when f.fix then ${img} else coalesce(r.image_url, ${img}) end,
      links = case when f.fix then (r.links - (case when f.song then ${SONG_CAPTURE_STRIPS} else ${PROVIDER_LINK_KEYS} end)::text[]) || ${JSON.stringify(m.links)}::jsonb
        else ${JSON.stringify(m.links)}::jsonb || r.links end,
      apple_music_id = case when f.fix and f.song then coalesce(${apple}, r.apple_music_id) when f.fix then ${apple}
        else coalesce(r.apple_music_id, ${apple}) end,
      lat = case when f.fix and r.type = 'place' then ${lat}::float8 else coalesce(${lat}::float8, r.lat) end,
      lng = case when f.fix and r.type = 'place' then ${lng}::float8 else coalesce(${lng}::float8, r.lng) end,
      art_retry_mbid = case when (case when f.fix and f.photo then coalesce(${img}, r.image_url) when f.fix then ${img}
        else coalesce(r.image_url, ${img}) end) is null then ${m.artRetry ?? null} end,
      art_retries = case when f.owner then 0 else r.art_retries end,
      match_source = case when f.owner then 'owner' else r.match_source end,
      owner_pick = ${opts.ownerPick ?? null},
      about = case when f.owner then null else r.about end, about_url = case when f.owner then null else r.about_url end,
      about_at = case when f.owner then null else r.about_at end, about_tries = case when f.owner then 0 else r.about_tries end,
      extras = case when f.owner then null else r.extras end, extras_at = case when f.owner then null else r.extras_at end,
      extras_tries = case when f.owner then 0 else r.extras_tries end,
      enrichment_status = 'matched', enriched_at = now(), updated_at = now()
    from (select id, ${owner}::boolean as owner, ${owner}::boolean and enrichment_status = 'matched' as fix,
            source = 'song' as song, source = 'photo' as photo
          from recommendations where id = ${id}) f
    where r.id = f.id and r.match_source = 'auto'
      and (f.owner or r.enrichment_status = 'pending' or (${web}::boolean and r.enrichment_status = 'no_match'))
      and (not ${web}::boolean or r.enriched_at is not distinct from ${opts.ifNoMatchAt ?? null}::timestamptz)
      and r.status <> all(${SWEEP_SKIPS_STATUSES}::text[])
      and (${opts.ifCandidates ?? null}::jsonb is null or r.match_candidates = ${opts.ifCandidates ?? null}::jsonb)
      and (${opts.ifPendingSince ?? null}::timestamptz is null or r.pending_since = ${opts.ifPendingSince ?? null}::timestamptz)
    returning r.id`;
  return rows.length > 0;
}

// Every lookup that came back with candidates keeps them, and what Jev chose ('none' = abstained, or under 0.8).
async function saveCandidates(
  id: number, provider: string, candidates: readonly Candidate[], picked: EnrichmentMatch | null, pk: string,
): Promise<void> {
  const stored = candidates.map((c) => ({ provider, ...c }));
  await db()`update recommendations set match_candidates = ${JSON.stringify(stored)}::jsonb, candidates_at = now(),
      auto_pick = ${picked ? describeCandidate(picked) : "none"}
    where id = ${id} and match_source = 'auto' and enrichment_status = 'pending' and pending_since = ${pk}::timestamptz`; // never over the owner's search results
}

async function saveLinkOnly(id: number, links: EnrichmentMatch["links"], pk: string): Promise<void> {
  await db()`update recommendations set links = ${JSON.stringify(links)}::jsonb || links,
      enrichment_status = 'no_match', enriched_at = now(), updated_at = now()
    where id = ${id} and enrichment_status = 'pending' and match_source = 'auto' and status <> all(${SWEEP_SKIPS_STATUSES}::text[])
      and pending_since = ${pk}::timestamptz`;
}

// 503/429: to the back of the line without an attempt, so one busy service never pins the queue; a tip pending for
// over a week gives up.
async function saveBusy(id: number, pk: string): Promise<void> {
  await db()`update recommendations set enrich_next_at = now() + make_interval(mins => ${BUSY_RETRY_MINUTES}),
      enrichment_status = case when pending_since < now() - make_interval(days => ${BUSY_GIVE_UP_DAYS}) then 'failed' else 'pending' end
    where id = ${id} and enrichment_status = 'pending' and pending_since = ${pk}::timestamptz`;
}

/** Returns true when this was the last allowed attempt. */
async function saveFailure(id: number, attempts: number, pk: string): Promise<boolean> {
  const gaveUp = attempts >= MAX_ATTEMPTS;
  await db()`update recommendations set enrich_attempts = ${attempts},
      enrichment_status = ${gaveUp ? "failed" : "pending"},
      enrich_next_at = now() + make_interval(mins => ${gaveUp ? 0 : retryDelayMinutes(attempts)})
    where id = ${id} and enrichment_status = 'pending' and pending_since = ${pk}::timestamptz`;
  return gaveUp;
}

// Final outcomes only (matched, final no_match, failed): a still-pending tip keeps whatever reason it has. A final
// outcome recomputes from scratch, so it replaces an earlier reason (no_recommender → no_match).
export async function applyReviewReason(id: number): Promise<void> {
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
      // art_retry_mbid unchanged: still the release this art belongs to (an owner's correction clears or replaces it)
      await db()`update recommendations set image_url = coalesce(image_url, ${url}), art_retry_mbid = null, art_retries = ${tries}
        where id = ${id} and art_retry_mbid = ${String(row.art_retry_mbid)}`;
      if (url) r.artFixed++;
    } catch (err) {
      logEnrichError("art-retry", { rec: id, mbid: String(row.art_retry_mbid) }, err);
      await db()`update recommendations set art_retries = ${tries},
          art_retry_mbid = ${tries >= MAX_ART_TRIES ? null : String(row.art_retry_mbid)}
        where id = ${id} and art_retry_mbid = ${String(row.art_retry_mbid)}`;
    }
  }
}
