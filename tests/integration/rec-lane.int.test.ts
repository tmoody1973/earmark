import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool, type PoolClient } from "@neondatabase/serverless";
import type { enrichRec, RecToEnrich } from "../../agent/lib/enrich/enrich";
import { ProviderHttpError, type EnrichmentMatch } from "../../agent/lib/enrich/types";

// Real Neon `test` branch (TEST_DATABASE_URL, never production); skipped when absent. Providers and Jev are fakes.
// Every sweep is scoped to this file's rows (onlyIds), so other suites' rows on the branch are never touched.
const AT = "2026-10-01T15:00:00Z";
type Enrich = typeof enrichRec;

describe.skipIf(!process.env.TEST_DATABASE_URL)("rec lane sweep on the Neon test branch (M3-T4)", () => {
  let pool: Pool;
  let c: PoolClient;
  const ids: number[] = [];
  // Summaries, Bee and embeddings are fakes in every sweep here unless a test passes its own (M3-T5).
  const quiet = { summarize: vi.fn(async () => null), beeSummary: vi.fn(async () => null), embedRecs: vi.fn(async () => 0),
    about: vi.fn(async () => null), // Wikipedia notes (M3-T4b): a fake unless a test passes its own
    extras: vi.fn(async () => ({})) }; // the tip page's extras (decision 045): never a real request here
  const lane = async () => {
    const m = await import("../../agent/lib/recs/lane");
    return { ...m, sweepRecLane: (d: Parameters<typeof m.sweepRecLane>[0] = {}) => m.sweepRecLane({ ...quiet, ...d }) };
  };

  const addRec = async (o: { type?: string; status?: string; name?: string; image?: string | null; links?: object } = {}) => {
    const { rows } = await c.query(
      `insert into recommendations (type, raw_text, canonical_name, excerpt, said_at, source, status, confidence, image_url, links)
       values ($1, 'it lane', $2, 'it lane', $3, 'ambient', $4, 0.9, $5, $6::jsonb) returning id`,
      [o.type ?? "book", o.name ?? "IT lane", AT, o.status ?? "new", o.image ?? null, JSON.stringify(o.links ?? {})]);
    ids.push(Number(rows[0].id));
    return Number(rows[0].id);
  };
  const row = async (id: number) => (await c.query(
    `select status, canonical_name, creator, image_url, links, enrichment_status, enrich_attempts, review_reason,
            art_retry_mbid, art_retries, extract(epoch from (enrich_next_at - now())) / 60 as next_in_min,
            extract(epoch from (now() - pending_since)) / 60 as pending_for_min
     from recommendations where id = $1`, [id])).rows[0];
  const match = (over: Partial<EnrichmentMatch> = {}): EnrichmentMatch =>
    ({ canonicalName: "Night Garden", creator: "Mara Vell", yearOrAddress: "2021", imageUrl: "https://img/new.jpg",
      links: { openlibrary: "https://openlibrary.org/works/OL1W" }, matchConfidence: 0.9, ...over });
  // A fake enrich that asks the (counted) Jev pick once, like the real providers do when there are candidates.
  const viaPick = (result: (r: RecToEnrich) => EnrichmentMatch | null): Enrich =>
    (async (r, deps) => deps!.pick!({ described: r.canonical_name, excerpt: r.excerpt }, [match()]).then(() => result(r))) as Enrich;
  const pick = vi.fn(async () => match());

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    c = await pool.connect();
  });

  afterAll(async () => {
    if (!c) return;
    await c.query(`delete from recommendations where id = any($1::bigint[])`, [ids]);
    await c.query(`delete from sync_cursors where name = 'rec_lane_lease'`);
    c.release();
    await pool.end();
  });

  it("enriches visible tips and maybes, never dismissed/composted, and waits on types without keys", async () => {
    const { sweepRecLane } = await lane();
    const book = await addRec({ name: "night garden", image: "https://photo/mine.jpg", links: { url: "https://mine.example" } });
    const maybe = await addRec({ type: "other", status: "needs_review" });
    const dismissed = await addRec({ status: "dismissed" });
    const composted = await addRec({ status: "composted" });
    const film = await addRec({ type: "film_tv" });
    const enrich = vi.fn(viaPick((r) => (r.type === "book" ? match() : null)));

    const res = await sweepRecLane({ enrich, pick, env: {}, onlyIds: ids });
    expect(res).toMatchObject({ status: "done", tried: 2, matched: 1, secondLook: 1, jevCalls: 2, waitingForKeys: ["film_tv"] }); // places are keyless since PR #39 (Nominatim)
    expect(enrich.mock.calls.map(([r]) => r.id).sort()).toEqual([book, maybe].sort());

    const b = await row(book);
    expect(b).toMatchObject({ enrichment_status: "matched", canonical_name: "Night Garden", creator: "Mara Vell",
      image_url: "https://photo/mine.jpg" }); // a capture's own photo wins over provider art
    expect(b.links).toEqual({ openlibrary: "https://openlibrary.org/works/OL1W", url: "https://mine.example" });
    expect(b.review_reason).toBe("no_recommender"); // matched, but nobody to credit
    // Jev saw candidates and said none fits: one more look an hour later, then final.
    await c.query(`update recommendations set pending_since = now() - interval '9 days' where id = $1`, [maybe]);
    await c.query(`update recommendations set enrich_next_at = now(), enrich_attempts = 0 where id = $1`, [maybe]);
    await sweepRecLane({ enrich, pick, env: {}, onlyIds: [maybe] }); // first look again, to watch the clock restart
    const m1 = await row(maybe);
    expect(m1).toMatchObject({ enrichment_status: "pending", enrich_attempts: 1, review_reason: null });
    expect(Number(m1.pending_for_min)).toBeLessThan(1);
    expect(Number(m1.next_in_min)).toBeGreaterThan(59);
    await c.query(`update recommendations set enrich_next_at = now() where id = $1`, [maybe]);
    expect(await sweepRecLane({ enrich, pick, env: {}, onlyIds: [maybe] })).toMatchObject({ tried: 1, noMatch: 1 });
    expect(await row(maybe)).toMatchObject({ enrichment_status: "no_match", review_reason: "confidence_band" });
    for (const id of [dismissed, composted, film]) expect((await row(id)).enrichment_status).toBe("pending");

    // Already enriched → never tried again.
    enrich.mockClear();
    expect(await sweepRecLane({ enrich, pick, env: {}, onlyIds: [book, maybe] })).toMatchObject({ tried: 0 });
    expect(enrich).not.toHaveBeenCalled();
  });

  it("a lookup with no candidates at all is final at once, with review reason no_match", async () => {
    const { sweepRecLane } = await lane();
    const id = await addRec();
    const enrich = vi.fn(async () => null) as unknown as Enrich; // nothing found: Jev never asked
    expect(await sweepRecLane({ enrich, pick, env: {}, onlyIds: [id] })).toMatchObject({ tried: 1, noMatch: 1, jevCalls: 0 });
    expect(await row(id)).toMatchObject({ enrichment_status: "no_match", enrich_attempts: 0, review_reason: "no_match" });
  });

  it("reasons are set only on final outcomes, and a later final outcome replaces an earlier reason", async () => {
    const { sweepRecLane } = await lane();
    const id = await addRec();
    await c.query(`update recommendations set review_reason = 'no_recommender' where id = $1`, [id]);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const flaky = vi.fn(async () => { throw Object.assign(new Error("x"), { name: "TimeoutError" }); }) as unknown as Enrich;
    await sweepRecLane({ enrich: flaky, pick, env: {}, onlyIds: [id] }); // retry: not final, reason untouched
    expect(await row(id)).toMatchObject({ enrichment_status: "pending", review_reason: "no_recommender" });

    await c.query(`update recommendations set enrich_next_at = now() where id = $1`, [id]);
    const nothing = vi.fn(async () => null) as unknown as Enrich;
    await sweepRecLane({ enrich: nothing, pick, env: {}, onlyIds: [id] });
    expect(await row(id)).toMatchObject({ enrichment_status: "no_match", review_reason: "no_match" });
  });

  it("a failed rec backs off, is skipped while waiting, and is given up after the last attempt", async () => {
    const { sweepRecLane, MAX_ATTEMPTS } = await lane();
    const id = await addRec();
    const enrich = vi.fn(async () => { throw Object.assign(new Error("x"), { name: "TimeoutError" }); }) as unknown as Enrich;
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await sweepRecLane({ enrich, pick, env: {}, onlyIds: [id] })).toMatchObject({ tried: 1, retry: 1 });
    const r1 = await row(id);
    expect(r1).toMatchObject({ enrichment_status: "pending", enrich_attempts: 1 });
    expect(Number(r1.next_in_min)).toBeGreaterThan(14);
    expect(await sweepRecLane({ enrich, pick, env: {}, onlyIds: [id] })).toMatchObject({ tried: 0 }); // still waiting

    await c.query(`update recommendations set enrich_attempts = $2, enrich_next_at = now() where id = $1`, [id, MAX_ATTEMPTS - 1]);
    expect(await sweepRecLane({ enrich, pick, env: {}, onlyIds: [id] })).toMatchObject({ tried: 1, gaveUp: 1 });
    expect(await row(id)).toMatchObject({ enrichment_status: "failed", enrich_attempts: MAX_ATTEMPTS });
  });

  it("a 503 stops the sweep and sends that tip to the back for 15 min without an attempt; a week-old tip gives up", async () => {
    const { sweepRecLane } = await lane();
    const first = await addRec();
    const second = await addRec();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const busy = vi.fn(async () => { throw new ProviderHttpError("musicbrainz.org", 503); }) as unknown as Enrich;

    expect(await sweepRecLane({ enrich: busy, pick, env: {}, onlyIds: [first, second] }))
      .toMatchObject({ tried: 1, stoppedOn: "musicbrainz.org 503" });
    expect(busy).toHaveBeenCalledTimes(1);
    const f = await row(first);
    expect(f).toMatchObject({ enrichment_status: "pending", enrich_attempts: 0 });
    expect(Number(f.next_in_min)).toBeGreaterThan(14);
    expect(await row(second)).toMatchObject({ enrichment_status: "pending", enrich_attempts: 0 });

    // Next run: the 503 tip is not first in line (not even due); the other one goes.
    const ok = vi.fn(async () => null) as unknown as Enrich;
    await sweepRecLane({ enrich: ok, pick, env: {}, onlyIds: [first, second] });
    expect(vi.mocked(ok).mock.calls.map(([r]) => (r as RecToEnrich).id)).toEqual([second]);

    // The week is counted from when the tip entered the queue, not from when it was said.
    const backlog = await addRec();
    await c.query(`update recommendations set created_at = now() - interval '30 days' where id = $1`, [backlog]);
    await sweepRecLane({ enrich: busy, pick, env: {}, onlyIds: [backlog] });
    expect(await row(backlog)).toMatchObject({ enrichment_status: "pending", enrich_attempts: 0 });

    const old = await addRec();
    await c.query(`update recommendations set pending_since = now() - interval '8 days' where id = $1`, [old]);
    await sweepRecLane({ enrich: busy, pick, env: {}, onlyIds: [old] });
    expect(await row(old)).toMatchObject({ enrichment_status: "failed", enrich_attempts: 0 });
  });

  it("caps Jev calls and recs per run", async () => {
    const { sweepRecLane, MAX_JEV_CALLS_PER_RUN, MAX_RECS_PER_RUN, MAX_SUMMARIES_PER_RUN } = await lane();
    const batch: number[] = [];
    for (let i = 0; i < MAX_RECS_PER_RUN + 1; i++) batch.push(await addRec());

    const summarize = vi.fn(async () => null);
    const viaJev = await sweepRecLane({ enrich: viaPick(() => null), pick, env: {}, onlyIds: batch, summarize });
    expect(viaJev).toMatchObject({ tried: MAX_JEV_CALLS_PER_RUN, jevCalls: MAX_JEV_CALLS_PER_RUN });
    expect(summarize).toHaveBeenCalledTimes(Math.min(MAX_SUMMARIES_PER_RUN, batch.length)); // its own cap, apart from Jev's

    await c.query(`update recommendations set enrichment_status = 'pending', enrich_next_at = now() where id = any($1::bigint[])`, [batch]);
    const noJev = vi.fn(async () => null) as unknown as Enrich; // e.g. no candidates: no Jev call
    expect(await sweepRecLane({ enrich: noJev, pick, env: {}, onlyIds: batch })).toMatchObject({ tried: MAX_RECS_PER_RUN, jevCalls: 0 });
  });

  it("skips the run while another sweep's lease is live; takes over a stale lease and releases it", async () => {
    const { sweepRecLane, REC_LANE_LEASE } = await lane();
    const id = await addRec();
    await c.query(`insert into sync_cursors (name, cursor) values ($1, 'other-runner')
      on conflict (name) do update set cursor = 'other-runner', updated_at = now()`, [REC_LANE_LEASE]);
    const enrich = vi.fn(async () => null) as unknown as Enrich;
    expect(await sweepRecLane({ enrich, pick, env: {}, onlyIds: [id] })).toEqual({ status: "locked" });
    expect(enrich).not.toHaveBeenCalled();

    await c.query(`update sync_cursors set updated_at = now() - interval '16 minutes' where name = $1`, [REC_LANE_LEASE]);
    expect(await sweepRecLane({ enrich, pick, env: {}, onlyIds: [id] })).toMatchObject({ status: "done", tried: 1 });
    expect((await c.query(`select 1 from sync_cursors where name = $1`, [REC_LANE_LEASE])).rowCount).toBe(0); // released
  });

  it("a lease taken over by another runner is not released by the first", async () => {
    const { sweepRecLane, REC_LANE_LEASE } = await lane();
    const id = await addRec();
    const thief = (async () => {
      await c.query(`update sync_cursors set cursor = 'thief' where name = $1`, [REC_LANE_LEASE]);
      return null;
    }) as unknown as Enrich;
    await sweepRecLane({ enrich: thief, pick, env: {}, onlyIds: [id] });
    expect((await c.query(`select cursor from sync_cursors where name = $1`, [REC_LANE_LEASE])).rows[0]?.cursor).toBe("thief");
    await c.query(`delete from sync_cursors where name = $1`, [REC_LANE_LEASE]);
  });

  it("retries Cover Art Archive only for a match whose art lookup errored, up to 3 tries", async () => {
    const { sweepRecLane, MAX_ART_TRIES } = await lane();
    const failed = await addRec({ type: "album" });
    const fixed = await addRec({ type: "album" });
    const withArt = (r: RecToEnrich) => match({ imageUrl: null, artRetry: `rg-${r.id}` });
    const enrich = vi.fn(async (r: RecToEnrich) => withArt(r)) as unknown as Enrich;
    const coverArt = vi.fn(async (rg: string) => {
      if (rg === `rg-${fixed}`) return "https://coverartarchive.org/x-500.jpg";
      throw new ProviderHttpError("coverartarchive.org", 502);
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await sweepRecLane({ enrich, pick, coverArt, env: {}, onlyIds: [failed, fixed] });
    expect(res).toMatchObject({ matched: 2, artFixed: 1 });
    expect(await row(fixed)).toMatchObject({ image_url: "https://coverartarchive.org/x-500.jpg", art_retry_mbid: null });
    expect(await row(failed)).toMatchObject({ image_url: null, art_retry_mbid: `rg-${failed}`, art_retries: 1 });

    for (let i = 1; i < MAX_ART_TRIES; i++) await sweepRecLane({ enrich, pick, coverArt, env: {}, onlyIds: [failed] });
    expect(await row(failed)).toMatchObject({ art_retry_mbid: null, art_retries: MAX_ART_TRIES });
    expect(coverArt.mock.calls.filter(([rg]) => rg === `rg-${failed}`)).toHaveLength(MAX_ART_TRIES);
    expect(enrich).toHaveBeenCalledTimes(2); // the tail never re-runs MusicBrainz or Jev
  });

  const vec = (id: number) => c.query(`update recommendations set embedding = array_fill(0.1::real, array[1536])::vector where id = $1`, [id]);
  const hasVec = async (id: number) => (await c.query(`select embedding is not null as v from recommendations where id = $1`, [id])).rows[0].v;
  const why = async (id: number) => (await c.query(`select context_summary, summarized_at is not null as done from recommendations where id = $1`, [id])).rows[0];

  it("writes each tip's why once (visible before maybes), null when there is none, and re-embeds what changed", async () => {
    const { sweepRecLane, MAX_EMBEDS_PER_RUN } = await lane();
    const seeded = await addRec({ name: "seeded" });
    const maybe = await addRec({ name: "maybe", status: "needs_review" });
    const plain = await addRec({ name: "no why" });
    const told = await addRec({ name: "told" });
    const dismissed = await addRec({ name: "gone", status: "dismissed" });
    const all = [seeded, maybe, plain, told, dismissed];
    await c.query(`update recommendations set enrichment_status = 'matched' where id = any($1::bigint[])`, [all]);
    await c.query(`update recommendations set context_summary = 'Hand-written why.', summarized_at = now() where id = $1`, [seeded]);
    await c.query(`update recommendations set bee_conversation_id = 4242 where id = $1`, [told]);
    for (const id of [told, plain]) await vec(id);
    const summarize = vi.fn(async (i: { name: string }) => (i.name === "no why" ? null : `Why for ${i.name}.`));
    const beeSummary = vi.fn(async () => "Lunch about noodles");
    const embedRecs = vi.fn(async () => 2);

    const res = await sweepRecLane({ enrich: vi.fn(async () => null) as unknown as Enrich, pick, env: {}, onlyIds: all, summarize, beeSummary, embedRecs });
    expect(res).toMatchObject({ summarized: 3, summaryFailed: 0, embedded: 2 });
    expect(summarize.mock.calls.map(([i]) => i.name)).toEqual(["told", "no why", "maybe"]); // newest visible first, maybes last
    expect(beeSummary).toHaveBeenCalledExactlyOnceWith(4242);
    expect(summarize.mock.calls[0]![0]).toMatchObject({ excerpt: "it lane", beeSummary: "Lunch about noodles", recommender: null });
    expect(embedRecs).toHaveBeenCalledWith(MAX_EMBEDS_PER_RUN);

    expect(await why(told)).toEqual({ context_summary: "Why for told.", done: true });
    expect(await hasVec(told)).toBe(false); // the why changed: embedded again from the new text
    expect(await why(plain)).toEqual({ context_summary: null, done: true }); // null, never filler, and not asked again
    expect(await hasVec(plain)).toBe(true); // nothing changed: the embedding stands
    expect(await why(seeded)).toEqual({ context_summary: "Hand-written why.", done: true });
    expect(await why(dismissed)).toEqual({ context_summary: null, done: false });

    summarize.mockClear();
    await sweepRecLane({ enrich: vi.fn(async () => null) as unknown as Enrich, pick, env: {}, onlyIds: all, summarize, beeSummary, embedRecs });
    expect(summarize).not.toHaveBeenCalled(); // each tip is asked once
  });

  it("a failed summary call is retried next run; Bee being down only drops its context", async () => {
    const { sweepRecLane } = await lane();
    const id = await addRec({ name: "flaky" });
    await c.query(`update recommendations set enrichment_status = 'matched', bee_conversation_id = 4243 where id = $1`, [id]);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const down = vi.fn(async () => { throw Object.assign(new Error("x"), { name: "TimeoutError" }); });
    const beeDown = vi.fn(async () => { throw Object.assign(new Error("x"), { name: "BeeApiError" }); });
    const failing = vi.fn(async () => { throw Object.assign(new Error("x"), { name: "AI_APICallError" }); });
    expect(await sweepRecLane({ env: {}, onlyIds: [id], summarize: failing, beeSummary: down, embedRecs: down }))
      .toMatchObject({ summarized: 0, summaryFailed: 1, embedded: 0 }); // the embed failure is logged, not thrown
    expect(await why(id)).toEqual({ context_summary: null, done: false });

    const ok = vi.fn<(i: { beeSummary: string | null }) => Promise<string>>(async () => "The noodles are hand-pulled.");
    await sweepRecLane({ env: {}, onlyIds: [id], summarize: ok, beeSummary: beeDown });
    expect(ok.mock.calls[0]![0]).toMatchObject({ beeSummary: null });
    expect(await why(id)).toEqual({ context_summary: "The noodles are hand-pulled.", done: true });
  });

  it("tips whose call always fails go to the back, never block older tips, and give up after 3 attempts", async () => {
    const { sweepRecLane, MAX_SUMMARY_ATTEMPTS } = await lane();
    const older = await addRec({ name: "older" });
    const bad = [await addRec({ name: "bad" }), await addRec({ name: "bad" }), await addRec({ name: "bad" })]; // newest first in line
    const all = [older, ...bad];
    await c.query(`update recommendations set enrichment_status = 'matched' where id = any($1::bigint[])`, [all]);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const summarize = vi.fn(async (i: { name: string }) => {
      if (i.name === "bad") throw Object.assign(new Error("x"), { name: "AI_APICallError" });
      return "Worth the drive for the view.";
    });
    const run = () => sweepRecLane({ env: {}, onlyIds: all, summarize });

    expect(await run()).toMatchObject({ summarized: 0, summaryFailed: 3 }); // 3 in a row: the run stops asking
    expect(await why(older)).toEqual({ context_summary: null, done: false });
    expect(await run()).toMatchObject({ summarized: 1 }); // the least-tried tip goes first
    expect(await why(older)).toEqual({ context_summary: "Worth the drive for the view.", done: true });

    for (let i = 2; i < MAX_SUMMARY_ATTEMPTS; i++) await run();
    expect(await run()).toMatchObject({ summarized: 0 }); // nothing left to ask
    const gaveUp = await c.query(`select context_summary, summarized_at is not null as done, summary_attempts
      from recommendations where id = any($1::bigint[])`, [bad]);
    expect(gaveUp.rows).toEqual(bad.map(() => ({ context_summary: null, done: true, summary_attempts: MAX_SUMMARY_ATTEMPTS })));
    expect(summarize.mock.calls.filter(([i]) => i.name === "bad")).toHaveLength(bad.length * MAX_SUMMARY_ATTEMPTS);
  });

  it("a crash in the why step is logged and the sweep still embeds and finishes", async () => {
    const { sweepRecLane } = await lane();
    const id = await addRec({ name: "crashy" });
    await c.query(`update recommendations set enrichment_status = 'matched', bee_conversation_id = 4244 where id = $1`, [id]);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const beeSummary = () => { throw Object.assign(new Error("x"), { name: "TypeError" }); }; // throws before any promise
    const embedRecs = vi.fn(async () => 0);
    expect(await sweepRecLane({ env: {}, onlyIds: [id], beeSummary: beeSummary as never, embedRecs })).toMatchObject({ status: "done" });
    expect(embedRecs).toHaveBeenCalled();
    expect(err.mock.calls.flat().join(" ")).toMatch(/rec-lane whys failed.*error=TypeError/);
  });

  it("a match that renames a tip drops its embedding; a match that changes nothing keeps it", async () => {
    const { sweepRecLane } = await lane();
    const renamed = await addRec({ name: "night garden" });
    const same = await addRec({ name: "Night Garden" });
    await c.query(`update recommendations set creator = 'Mara Vell' where id = $1`, [same]);
    for (const id of [renamed, same]) await vec(id);
    await sweepRecLane({ enrich: vi.fn(async () => match()) as unknown as Enrich, pick, env: {}, onlyIds: [renamed, same] });
    expect(await hasVec(renamed)).toBe(false);
    expect(await hasVec(same)).toBe(true);
  });

  // M3-T4b: the Wikipedia note.
  const note = async (id: number) => (await c.query(`select about, about_url, about_at is not null as looked, about_tries as tries
    from recommendations where id = $1`, [id])).rows[0];
  const matched = async (o: Parameters<typeof addRec>[0] & { creator?: string } = {}) => {
    const id = await addRec(o);
    await c.query(`update recommendations set enrichment_status = 'matched', creator = $2, summarized_at = now()
      where id = $1`, [id, o.creator ?? null]);
    return id;
  };
  const SAULT = { text: "Sault are a British music group.", url: "https://en.wikipedia.org/wiki/Sault_(band)" };

  it("writes a Wikipedia note once for matched tips; pending and cleared tips get none; errors retry up to 3 times", async () => {
    const { sweepRecLane } = await lane();
    const album = await matched({ type: "album", name: "Untitled (Rise)", creator: "SAULT",
      links: { musicbrainz: "https://musicbrainz.org/release-group/0b2d4ec0-0000-4000-8000-000000000001" } });
    const unsure = await matched({ type: "artist", name: "Low" });
    const failing = await matched({ type: "place", name: "Kopp's" });
    const pending = await addRec({ type: "book", name: "Pending book" });
    const dismissed = await matched({ type: "artist", name: "Gone", status: "dismissed" });
    const all = [album, unsure, failing, pending, dismissed];
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const about = vi.fn(async (r: { canonical_name: string }) => {
      if (r.canonical_name === "Kopp's") throw Object.assign(new Error("t"), { name: "TimeoutError" });
      return r.canonical_name === "Low" ? null : SAULT;
    });
    const enrich = vi.fn(async () => null) as unknown as Enrich;

    expect(await sweepRecLane({ enrich, pick, env: {}, onlyIds: all, about })).toMatchObject({ abouts: 1 });
    expect(about.mock.calls.map(([r]) => r.canonical_name).sort()).toEqual(["Kopp's", "Low", "Untitled (Rise)"]);
    expect(about.mock.calls.find(([r]) => r.canonical_name === "Untitled (Rise)")![0]).toEqual({ type: "album",
      canonical_name: "Untitled (Rise)", creator: "SAULT", year_or_address: null,
      links: { musicbrainz: "https://musicbrainz.org/release-group/0b2d4ec0-0000-4000-8000-000000000001" } });
    expect(await note(album)).toEqual({ about: SAULT.text, about_url: SAULT.url, looked: true, tries: 0 });
    expect(await note(unsure)).toEqual({ about: null, about_url: null, looked: true, tries: 0 }); // unsure: nothing, ever
    expect(await note(failing)).toEqual({ about: null, about_url: null, looked: false, tries: 1 }); // an error: try again
    expect(err.mock.calls.flat().join(" ")).toMatch(/rec-lane about failed rec=\d+ error=TimeoutError/);
    for (const id of [pending, dismissed]) expect(await note(id)).toEqual({ about: null, about_url: null, looked: false, tries: 0 });

    for (let run = 2; run <= 3; run++) {
      about.mockClear();
      await sweepRecLane({ enrich, pick, env: {}, onlyIds: all, about });
      expect(about.mock.calls.map(([r]) => r.canonical_name)).toEqual(["Kopp's"]); // only the failed one is asked again
    }
    expect(await note(failing)).toEqual({ about: null, about_url: null, looked: true, tries: 3 }); // 3 tries: done
    about.mockClear();
    await sweepRecLane({ enrich, pick, env: {}, onlyIds: all, about });
    expect(about).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it("caps Wikipedia lookups per run and stops on a 429; forgetting the tip deletes its note", async () => {
    const { sweepRecLane, MAX_ABOUTS_PER_RUN } = await lane();
    const batch: number[] = [];
    for (let i = 0; i < MAX_ABOUTS_PER_RUN + 2; i++) batch.push(await matched({ type: "artist", name: `cap ${i}` }));
    const about = vi.fn(async () => SAULT);
    expect(await sweepRecLane({ env: {}, onlyIds: batch, about })).toMatchObject({ abouts: MAX_ABOUTS_PER_RUN });
    expect(about).toHaveBeenCalledTimes(MAX_ABOUTS_PER_RUN);

    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const busy = vi.fn(async () => { throw new ProviderHttpError("en.wikipedia.org", 429); });
    const rest = [await matched({ type: "artist", name: "busy 1" }), await matched({ type: "artist", name: "busy 2" })];
    await sweepRecLane({ env: {}, onlyIds: rest, about: busy });
    expect(busy).toHaveBeenCalledTimes(1); // Wikipedia asked us to slow down: no more lookups this run
    for (const id of rest) expect(await note(id)).toMatchObject({ looked: false, tries: 0 }); // and nothing counted
    err.mockRestore();

    // Forget's own row step (forget-rows.ts) deletes the recommendations row, and the note lives on that row.
    const { readPlan, deleteRows } = await import("../../agent/lib/privacy/forget-rows");
    const noted = batch.at(-1)!; // newest first: the oldest two wait for the next run
    expect((await note(noted)).about).toBe(SAULT.text);
    expect((await note(batch[0]!)).looked).toBe(false);
    await deleteRows(c, await readPlan(c, { type: "rec", id: noted }, false));
    expect((await c.query(`select count(*)::int as n from recommendations where id = $1`, [noted])).rows[0].n).toBe(0);
  });

  it("video tips (add-on, migration 015): the type is allowed; a spoken title gets a search link, an emailed URL its oEmbed", async () => {
    const { sweepRecLane } = await lane();
    const { enrichRec } = await import("../../agent/lib/enrich/enrich");
    await expect(addRec({ type: "bogus" })).rejects.toThrow(/recommendations_type_check/);
    const spoken = await addRec({ type: "video", name: "Veritasium" });
    const url = "https://www.youtube.com/watch?v=6avJHaC3C2U";
    const emailed = await addRec({ type: "video", name: "the art of code talk", links: { urls: ["https://example.com/x", url] } });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ title: "The Art of Code - Dylan Beattie",
      author_name: "NDC Conferences", thumbnail_url: "https://i.ytimg.com/vi/6avJHaC3C2U/hqdefault.jpg" }), { status: 200 }));
    const enrich: Enrich = (r, deps) => enrichRec(r, { ...deps, fetchImpl: fetchImpl as never });

    const res = await sweepRecLane({ enrich, pick, env: {}, onlyIds: [spoken, emailed] });
    expect(res).toMatchObject({ status: "done", tried: 2, matched: 1, noMatch: 1, jevCalls: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(1); // only the tip that carries a URL; a spoken title runs no search
    // link only (nothing identified): no_match, so it reaches review (M3-T9), but the search link is kept for the card
    expect(await row(spoken)).toMatchObject({ enrichment_status: "no_match", review_reason: "no_match", image_url: null,
      canonical_name: "Veritasium", links: { primary: "https://www.youtube.com/results?search_query=Veritasium" } });
    const e = await row(emailed);
    expect(e).toMatchObject({ enrichment_status: "matched", canonical_name: "The Art of Code - Dylan Beattie",
      creator: "NDC Conferences", image_url: "https://i.ytimg.com/vi/6avJHaC3C2U/hqdefault.jpg" });
    expect(e.links).toEqual({ youtube: url, urls: ["https://example.com/x", url] });
  });

  // Decision 045: the tip page's extras, fetched once after the about step.
  const extrasOf = async (id: number) => (await c.query(`select extras, extras_at is not null as looked, extras_tries as tries
    from recommendations where id = $1`, [id])).rows[0];
  const aboutDone = async (o: Parameters<typeof matched>[0] = {}) => {
    const id = await matched(o);
    await c.query(`update recommendations set about_at = now() where id = $1`, [id]);
    return id;
  };
  const PREVIEW = { preview: { audioUrl: "https://audio-ssl.itunes.apple.com/p.m4a", appleUrl: "https://music.apple.com/us/album/x/1" } };

  it("stores extras once for matched tips whose about step is done; others wait; errors retry up to 3 times", async () => {
    const { sweepRecLane, MAX_EXTRAS_TRIES } = await lane();
    const song = await aboutDone({ type: "song", name: "Movement 1", creator: "Floating Points" });
    const nothing = await aboutDone({ type: "place", name: "Kopp's" });
    const failing = await aboutDone({ type: "book", name: "Flaky book" });
    const aboutPending = await matched({ type: "album", name: "No about yet" }); // the about step hasn't looked: wait
    const pending = await addRec({ type: "song", name: "Pending song" });
    const dismissed = await aboutDone({ type: "song", name: "Gone", status: "dismissed" });
    const all = [song, nothing, failing, aboutPending, pending, dismissed];
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const extras = vi.fn(async (r: { canonical_name: string }) => {
      if (r.canonical_name === "Flaky book") throw Object.assign(new Error("t"), { name: "TimeoutError" });
      return r.canonical_name === "Movement 1" ? PREVIEW : {};
    });

    // the about step errors for this one, so its about_at stays null and the extras step must not look at it yet
    const about = vi.fn(async (r: { canonical_name: string }) => {
      if (r.canonical_name === "No about yet") throw Object.assign(new Error("t"), { name: "TimeoutError" });
      return null;
    });
    expect(await sweepRecLane({ env: {}, onlyIds: all, extras, about })).toMatchObject({ extras: 1 });
    expect(extras.mock.calls.map(([r]) => r.canonical_name).sort()).toEqual(["Flaky book", "Kopp's", "Movement 1"]);
    expect(extras.mock.calls.find(([r]) => r.canonical_name === "Movement 1")![0]).toEqual({ type: "song",
      canonical_name: "Movement 1", creator: "Floating Points", apple_music_id: null, links: {}, about_url: null });
    expect(await extrasOf(song)).toEqual({ extras: PREVIEW, looked: true, tries: 0 });
    expect(await extrasOf(nothing)).toEqual({ extras: {}, looked: true, tries: 0 }); // looked, nothing: never asked again
    expect(await extrasOf(failing)).toEqual({ extras: null, looked: false, tries: 1 });
    expect(err.mock.calls.flat().join(" ")).toMatch(/rec-lane extras failed rec=\d+ error=TimeoutError/);
    for (const id of [aboutPending, pending, dismissed]) expect(await extrasOf(id)).toEqual({ extras: null, looked: false, tries: 0 });

    const rest = all.filter((id) => id !== aboutPending); // (its about step would give up after 3 errors, then it's due)
    for (let run = 2; run <= MAX_EXTRAS_TRIES; run++) {
      extras.mockClear();
      await sweepRecLane({ env: {}, onlyIds: rest, extras, about });
      expect(extras.mock.calls.map(([r]) => r.canonical_name)).toEqual(["Flaky book"]); // only the failed one again
    }
    expect(await extrasOf(failing)).toEqual({ extras: null, looked: false, tries: MAX_EXTRAS_TRIES }); // 3 tries: done
    extras.mockClear();
    await sweepRecLane({ env: {}, onlyIds: rest, extras, about });
    expect(extras).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it("caps extras lookups per run and stops on a 503 without counting a try; forgetting the tip deletes its extras", async () => {
    const { sweepRecLane, MAX_EXTRAS_PER_RUN } = await lane();
    const batch: number[] = [];
    for (let i = 0; i < MAX_EXTRAS_PER_RUN + 2; i++) batch.push(await aboutDone({ type: "song", name: `extras cap ${i}` }));
    const extras = vi.fn(async () => PREVIEW);
    expect(await sweepRecLane({ env: {}, onlyIds: batch, extras })).toMatchObject({ extras: MAX_EXTRAS_PER_RUN });
    expect(extras).toHaveBeenCalledTimes(MAX_EXTRAS_PER_RUN);

    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const busy = vi.fn(async () => { throw new ProviderHttpError("itunes.apple.com", 503); });
    const rest = [await aboutDone({ type: "song", name: "busy 1" }), await aboutDone({ type: "song", name: "busy 2" })];
    await sweepRecLane({ env: {}, onlyIds: rest, extras: busy });
    expect(busy).toHaveBeenCalledTimes(1); // the service asked us to slow down: no more lookups this run
    for (const id of rest) expect(await extrasOf(id)).toEqual({ extras: null, looked: false, tries: 0 }); // nothing counted
    err.mockRestore();

    const { readPlan, deleteRows } = await import("../../agent/lib/privacy/forget-rows");
    const stored = batch.at(-1)!; // newest first
    expect((await extrasOf(stored)).extras).toEqual(PREVIEW);
    await deleteRows(c, await readPlan(c, { type: "rec", id: stored }, false));
    expect((await c.query(`select count(*)::int as n from recommendations where id = $1`, [stored])).rows[0].n).toBe(0);
  });

  it("a dead podcast feed (503) burns a try and the next tip in the same run is still looked up", async () => {
    const { sweepRecLane } = await lane();
    const { fetchExtras } = await import("../../agent/lib/enrich/extras");
    const song = await aboutDone({ type: "song", name: "Feed neighbour", creator: "IT Band" });
    await c.query(`update recommendations set apple_music_id = '42' where id = $1`, [song]);
    const show = await aboutDone({ type: "podcast", name: "Dead Feed Show", // newer: first in line
      links: { apple_podcasts: "https://podcasts.apple.com/us/podcast/dead/id777" } });
    const res = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("lookup?id=777")) return res({ results: [{ collectionName: "Dead Feed Show", feedUrl: "https://dead.example.com/rss" }] });
      if (url.includes("lookup?id=42")) return res({ results: [{ wrapperType: "track", trackName: "Feed neighbour", artistName: "IT Band",
        previewUrl: "https://audio-ssl.itunes.apple.com/n.m4a", trackViewUrl: "https://music.apple.com/us/album/n/1?i=2" }] });
      return new Response("down", { status: 503 }); // the feed host
    });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await sweepRecLane({ env: {}, onlyIds: [show, song], extras: (r) => fetchExtras(r, fetchImpl as never) });
    expect(await extrasOf(show)).toEqual({ extras: null, looked: false, tries: 1 }); // a try, not a back-off
    expect(await extrasOf(song)).toMatchObject({ looked: true, extras: { preview: { audioUrl: "https://audio-ssl.itunes.apple.com/n.m4a" } } });
    err.mockRestore();
  });

  it("a tip forgotten while its extras were being fetched is not counted", async () => {
    const { sweepRecLane } = await lane();
    const id = await aboutDone({ type: "song", name: "Forgotten mid-run" });
    const extras = vi.fn(async () => {
      await c.query(`delete from recommendations where id = $1`, [id]);
      return PREVIEW;
    });
    expect(await sweepRecLane({ env: {}, onlyIds: [id], extras })).toMatchObject({ extras: 0 });
    expect(extras).toHaveBeenCalledTimes(1);
  });

  it("runRecLane queues a pending rec for the next sweep without calling any provider", async () => {
    const { runRecLane } = await lane();
    const id = await addRec();
    await c.query(`update recommendations set enrich_next_at = now() + interval '1 hour' where id = $1`, [id]);
    await c.query(`update recommendations set pending_since = now() - interval '9 days' where id = $1`, [id]);
    expect(await runRecLane(id)).toEqual({ queued: true });
    expect(Number((await row(id)).next_in_min)).toBeLessThanOrEqual(0);
    expect(Number((await row(id)).pending_for_min)).toBeLessThan(1); // the give-up clock restarts
    await c.query(`update recommendations set enrichment_status = 'matched' where id = $1`, [id]);
    expect(await runRecLane(id)).toEqual({ queued: false });
  });
});
