import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool, type PoolClient } from "@neondatabase/serverless";
import type { enrichRec } from "../../agent/lib/enrich/enrich";
import type { EnrichmentMatch } from "../../agent/lib/enrich/types";

// "Fix this tip" (decision 049) on the Neon `test` branch (TEST_DATABASE_URL, never production); skipped when absent.
// Providers, Jev and the why model are fakes: no real network. Sweeps are scoped to this file's rows (onlyIds).
const AT = "2026-10-01T15:00:00Z";
const VEC = `[${Array(1536).fill(0.01).join(",")}]`;

// Everything a match of the old words left behind, on top of what the capture itself brought (links.url).
const MATCHED = `enrichment_status = 'matched', enriched_at = now(), enrich_attempts = 2, review_reason = 'no_match',
  creator = 'Jemetta Rose', year_or_address = '2019', image_url = 'https://coverartarchive.org/release-group/x/front-250',
  apple_music_id = '111', links = '{"url":"https://example.com/heard","musicbrainz":"https://musicbrainz.org/x","apple_music":"https://music.apple.com/x","discogs":"https://discogs.com/x"}'::jsonb,
  about = 'A singer.', about_url = 'https://en.wikipedia.org/wiki/X', about_at = now(), about_tries = 1,
  extras = '{"preview":{}}'::jsonb, extras_at = now(), extras_tries = 1, art_retry_mbid = 'rg-1', art_retries = 2,
  match_candidates = '[]'::jsonb, candidates_at = now(), auto_pick = 'none', owner_pick = 'x', match_source = 'owner',
  owner_none_at = now(), embedding = '${VEC}'::vector, context_summary = 'On Sun Raw Records.', summarized_at = now()`;

describe.skipIf(!process.env.TEST_DATABASE_URL)("Fix this tip on the Neon test branch (decision 049)", () => {
  let pool: Pool;
  let c: PoolClient;
  const ids: number[] = [];
  const quiet = { summarize: vi.fn(async () => null), beeSummary: vi.fn(async () => null), embedRecs: vi.fn(async () => 0),
    about: vi.fn(async () => null), extras: vi.fn(async () => ({})) };
  const sweep = async (d: Parameters<typeof import("../../agent/lib/recs/lane").sweepRecLane>[0]) =>
    (await import("../../agent/lib/recs/lane")).sweepRecLane({ ...quiet, env: {}, ...d });
  const fix = async (...a: Parameters<typeof import("../../agent/lib/recs/fix-tip").applyTipFix>) =>
    (await import("../../agent/lib/recs/fix-tip")).applyTipFix(...a);

  const addRec = async (o: { type?: string; source?: string; status?: string; set?: string } = {}) => {
    const { rows } = await c.query(
      `insert into recommendations (type, raw_text, canonical_name, excerpt, said_at, source, status, confidence)
       values ($1, 'it fix', 'Jemetta Rose''s new albums', 'it fix', $2, $3, $4, 0.9) returning id`,
      [o.type ?? "album", AT, o.source ?? "ambient", o.status ?? "new"]);
    const id = Number(rows[0].id);
    ids.push(id);
    if (o.set) await c.query(`update recommendations set ${o.set} where id = $1`, [id]);
    return id;
  };
  const row = async (id: number) => (await c.query(
    `select type, canonical_name, creator, year_or_address, image_url, apple_music_id, links, lat, lng, enrichment_status,
            enrich_attempts, enriched_at, review_reason, match_source, owner_none_at, owner_pick, auto_pick, match_candidates,
            candidates_at, about, about_url, about_at, about_tries, extras, extras_at, extras_tries, art_retry_mbid, art_retries,
            embedding is null as no_embedding, context_summary, why_source, excerpt, raw_text, enrich_next_at <= now() as due
     from recommendations where id = $1`, [id])).rows[0];

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

  it("new words send the tip back for a fresh lookup and clear everything the old words matched", async () => {
    const id = await addRec({ set: MATCHED });
    expect(await fix(id, { name: "Sun Ra" })).toEqual({ changed: true, requeued: true });
    const r = await row(id);
    expect(r).toMatchObject({
      canonical_name: "Sun Ra", creator: "Jemetta Rose", type: "album", // the owner's words; an untouched field stays
      enrichment_status: "pending", enrich_attempts: 0, enriched_at: null, review_reason: null, due: true,
      match_source: "auto", owner_none_at: null, owner_pick: null, auto_pick: null, match_candidates: null, candidates_at: null,
      year_or_address: null, image_url: null, apple_music_id: null, art_retry_mbid: null, art_retries: 0,
      about: null, about_url: null, about_at: null, about_tries: 0, extras: null, extras_at: null, extras_tries: 0,
      no_embedding: true, context_summary: "On Sun Raw Records.", why_source: "auto", // the why is not the words: it stays
      excerpt: "it fix", raw_text: "it fix", // what Bee heard is never edited
    });
    expect(r.links).toEqual({ url: "https://example.com/heard" }); // the capture's own link stays

    // The lane looks the corrected words up; the provider's canonical name replaces the owner's typing.
    const match: EnrichmentMatch = { canonicalName: "The Magic City", creator: "Sun Ra", yearOrAddress: "1966", imageUrl: null,
      links: { musicbrainz: "https://musicbrainz.org/release-group/sunra" }, matchConfidence: 0.95 };
    const enrich = vi.fn(async () => match) as unknown as typeof enrichRec;
    expect(await sweep({ enrich, onlyIds: [id] })).toMatchObject({ matched: 1 });
    expect(vi.mocked(enrich).mock.calls[0]![0]).toMatchObject({ canonical_name: "Sun Ra", creator: "Jemetta Rose" });
    expect(await row(id)).toMatchObject({ canonical_name: "The Magic City", creator: "Sun Ra", enrichment_status: "matched" });
  });

  it("a capture keeps what it brought itself: a photo its picture, a shared song its Apple Music id and link", async () => {
    const photo = await addRec({ source: "photo", set: MATCHED });
    expect(await fix(photo, { creator: "Sun Ra" })).toEqual({ changed: true, requeued: true });
    expect(await row(photo)).toMatchObject({ creator: "Sun Ra", image_url: "https://coverartarchive.org/release-group/x/front-250", apple_music_id: null });

    const song = await addRec({ type: "song", source: "song", set: MATCHED });
    expect(await fix(song, { type: "album" })).toEqual({ changed: true, requeued: true });
    const s = await row(song);
    expect(s).toMatchObject({ type: "album", apple_music_id: "111", image_url: null });
    expect(s.links).toEqual({ url: "https://example.com/heard", apple_music: "https://music.apple.com/x" });
  });

  it("a place's coordinates came from the old match: they go when its words or type change", async () => {
    const place = await addRec({ type: "place", set: `${MATCHED}, lat = 43.04, lng = -87.91` });
    await fix(place, { name: "Sun Ra Arkestra Hall" });
    expect(await row(place)).toMatchObject({ lat: null, lng: null });
    const nowPlace = await addRec({ set: "lat = 43.04, lng = -87.91" });
    await fix(nowPlace, { type: "place" });
    expect(await row(nowPlace)).toMatchObject({ type: "place", lat: null, lng: null });
  });

  it("a note alone is written and final: no fresh lookup, and the lane's why step never writes over it", async () => {
    const id = await addRec({ set: "enrichment_status = 'matched', enriched_at = now()" }); // not summarized yet
    expect(await fix(id, { note: "On Sun Ra's own label, Saturn." })).toEqual({ changed: true, requeued: false });
    expect(await row(id)).toMatchObject({ context_summary: "On Sun Ra's own label, Saturn.", why_source: "owner", enrichment_status: "matched", no_embedding: true });

    const summarize = vi.fn(async () => "The lane's own why.");
    await sweep({ summarize, onlyIds: [id] });
    expect(summarize).not.toHaveBeenCalled();
    expect(await row(id)).toMatchObject({ context_summary: "On Sun Ra's own label, Saturn.", why_source: "owner" });

    // Clearing the note hands the why back to the lane.
    expect(await fix(id, { note: null })).toEqual({ changed: true, requeued: false });
    expect(await row(id)).toMatchObject({ context_summary: null, why_source: "auto" });
    await sweep({ summarize, onlyIds: [id] });
    expect(await row(id)).toMatchObject({ context_summary: "The lane's own why.", why_source: "auto" });
  });

  it("refuses a cleared tip, a missing one, and a fix that changes nothing", async () => {
    for (const status of ["dismissed", "composted"]) {
      const id = await addRec({ status, set: MATCHED });
      expect(await fix(id, { name: "Sun Ra", note: "x" })).toEqual({ changed: false, requeued: false });
      expect(await row(id)).toMatchObject({ canonical_name: "Jemetta Rose's new albums", enrichment_status: "matched", context_summary: "On Sun Raw Records." });
    }
    expect(await fix(Number.MAX_SAFE_INTEGER, { name: "Sun Ra" })).toEqual({ changed: false, requeued: false });
    const same = await addRec({ set: MATCHED });
    expect(await fix(same, { name: "Jemetta Rose's new albums", creator: "Jemetta Rose", note: "On Sun Raw Records." }))
      .toEqual({ changed: false, requeued: false });
    expect(await row(same)).toMatchObject({ enrichment_status: "matched", no_embedding: false });
    await expect(fix(0, { name: "Sun Ra" })).rejects.toThrow();
    await expect(fix(same, {})).rejects.toThrow();
  });

  it("a maybe (needs_review) can be fixed too: the lane looks maybes up", async () => {
    const id = await addRec({ status: "needs_review", set: MATCHED });
    expect(await fix(id, { name: "Sun Ra" })).toEqual({ changed: true, requeued: true });
  });
});
