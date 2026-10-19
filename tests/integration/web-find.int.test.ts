import { generateKeyPairSync } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool, type PoolClient } from "@neondatabase/serverless";
import type { enrichRec } from "../../agent/lib/enrich/enrich";
import { resetMusicBrainzThrottle } from "../../agent/lib/enrich/musicbrainz";
import type { Candidate } from "../../agent/lib/enrich/types";
import type { WebTip } from "../../agent/lib/recs/web-find";

// "Find it on the web" (decision 051) on the Neon `test` branch (TEST_DATABASE_URL, never production); skipped when absent.
// TinyFish, MusicBrainz, Apple, the model, Jev and the page fetch are all fakes: no real network. Sweeps are scoped to
// this file's rows (onlyIds).
const AT = "2026-10-01T15:00:00Z";
type Enrich = typeof enrichRec;
const EXCERPT = "SAID-VERBATIM her new albums as a tribute to Sun Raw Records";
const KEY_ENV = { TINYFISH_API_KEY: "tf-test-key" };
const APPLE_ENV = { ...KEY_ENV, APPLE_TEAM_ID: "T", APPLE_MUSIC_KEY_ID: "K",
  APPLE_MUSIC_PRIVATE_KEY: generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
const PAGE = "https://jimettarose.bandcamp.com/album/mettasun";
const RESULTS = [
  { position: 1, title: "MettaSun | Jimetta Rose", snippet: "Jimetta Rose's tribute to Sun Ra", site_name: "jimettarose.bandcamp.com", url: PAGE },
  { position: 2, title: "Jimetta Rose on MettaSun", snippet: "An interview", site_name: "magz.example.com", url: "https://magz.example.com/mettasun" },
];
const appleAlbum = (id: string, name: string) => ({ id, attributes: { name, artistName: "Jimetta Rose", releaseDate: "2026-09-01",
  url: `https://music.apple.com/us/album/${id}`, artwork: { url: `https://is1-ssl.mzstatic.com/${id}/{w}x{h}.jpg` } } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// One fake internet: TinyFish answers RESULTS (or `tinyfishStatus`), MusicBrainz knows nothing, Apple knows the albums
// in `apple` by name (its search term carries the name).
const net = (o: { apple?: Record<string, string>; tinyfishStatus?: number } = {}) => vi.fn(async (u: string) => {
  if (u.startsWith("https://api.search.tinyfish.ai")) {
    return o.tinyfishStatus ? json({ error: { code: "RATE_LIMIT_EXCEEDED" } }, o.tinyfishStatus) : json({ query: "q", results: RESULTS, total_results: 2, page: 0 });
  }
  if (u.startsWith("https://musicbrainz.org/")) return json({ "release-groups": [] });
  if (u.startsWith("https://api.music.apple.com/")) {
    const term = decodeURIComponent(new URL(u).searchParams.get("term") ?? "").replace(/\+/g, " ");
    return json({ results: { albums: { data: Object.entries(o.apple ?? {}).filter(([name]) => term.startsWith(name)).map(([name, id]) => appleAlbum(id, name)) } } });
  }
  return json({}, 404);
});
const answer = (options: { title: string; creator: string | null; result: number | null }[]) =>
  vi.fn<(o: { prompt: string }) => Promise<{ output: { options: typeof options } }>>(async () => ({ output: { options } }));

describe.skipIf(!process.env.TEST_DATABASE_URL)("Find it on the web on the Neon test branch (decision 051)", () => {
  let pool: Pool;
  let c: PoolClient;
  const ids: number[] = [];
  const quiet = { summarize: vi.fn(async () => null), beeSummary: vi.fn(async () => null), embedRecs: vi.fn(async () => 0),
    about: vi.fn(async () => null), extras: vi.fn(async () => ({})) };
  const laneMod = () => import("../../agent/lib/recs/lane");
  const sweep = async (d: Parameters<Awaited<ReturnType<typeof laneMod>>["sweepRecLane"]>[0]) =>
    (await laneMod()).sweepRecLane({ ...quiet, env: {}, ...d });
  // The real lookups with the fake internet: the catalog lookup (enrichRec) and the web find (findOnWeb).
  const realEnrich = (fetchImpl: ReturnType<typeof net>): Enrich => async (r, deps) =>
    (await import("../../agent/lib/enrich/enrich")).enrichRec(r, { ...deps, fetchImpl: fetchImpl as unknown as typeof fetch });
  const realWebFind = (env: Record<string, string>, fetchImpl: ReturnType<typeof net>, generateImpl: ReturnType<typeof answer>) =>
    async (t: WebTip) => (await import("../../agent/lib/recs/web-find")).findOnWeb(t,
      { env, fetchImpl: fetchImpl as unknown as typeof fetch, generateImpl: generateImpl as never, model: "test/model" });
  const pick = vi.fn(async () => null); // Jev: never called here (no catalog candidates), and never picks

  // A tip described, not titled: what Bee heard was a description of the album.
  const addRec = async (o: { set?: string; creator?: string | null } = {}) => {
    const { rows } = await c.query(
      `insert into recommendations (type, raw_text, canonical_name, creator, excerpt, said_at, source, status, confidence, context_summary)
       values ('album', $1, 'Sun Ra-inspired album', $2, $1, $3, 'ambient', 'new', 0.9, 'Ann says it is her tribute to Sun Ra.') returning id`,
      [EXCERPT, o.creator === undefined ? "Jimetta Rose" : o.creator, AT]);
    const id = Number(rows[0].id);
    ids.push(id);
    if (o.set) await c.query(`update recommendations set ${o.set} where id = $1`, [id]);
    return id;
  };
  // Already looked up by the catalogs and found nothing; its why is written.
  const NO_MATCH = `enrichment_status = 'no_match', enriched_at = now() - interval '1 minute', summarized_at = now()`;
  const row = async (id: number) => (await c.query(
    `select canonical_name, creator, image_url, apple_music_id, links, enrichment_status, match_source, review_reason,
            match_candidates, candidates_at, enriched_at, web_looked_at, owner_pick
     from recommendations where id = $1`, [id])).rows[0];

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    c = await pool.connect();
  });
  beforeEach(() => resetMusicBrainzThrottle());

  afterAll(async () => {
    if (!c) return;
    await c.query(`delete from recommendations where id = any($1::bigint[])`, [ids]);
    await c.query(`delete from sync_cursors where name = 'rec_lane_lease'`);
    c.release();
    await pool.end();
  });

  it("a music tip the catalogs can't find by its words ends matched via the web, with Apple's id, link and art", async () => {
    const id = await addRec();
    const fetchImpl = net({ apple: { MettaSun: "1700" } });
    const generateImpl = answer([{ title: "MettaSun", creator: "Jimetta Rose", result: 1 }]);
    const r = await sweep({ enrich: realEnrich(fetchImpl), pick, env: APPLE_ENV, webFind: realWebFind(APPLE_ENV, fetchImpl, generateImpl),
      summarize: vi.fn(async () => "Ann says it is her tribute to Sun Ra."), onlyIds: [id] });
    expect(r).toMatchObject({ noMatch: 1, webFinds: 1, webMatched: 1 });

    const m = await row(id);
    expect(m).toMatchObject({ enrichment_status: "matched", match_source: "auto", canonical_name: "MettaSun", creator: "Jimetta Rose",
      image_url: "https://is1-ssl.mzstatic.com/1700/600x600.jpg", apple_music_id: "1700",
      review_reason: "no_recommender" }); // recomputed on the match: no longer no_match (this test tip has no recommender)
    expect(m.links).toEqual({ apple_music: "https://music.apple.com/us/album/1700" });
    expect(m.web_looked_at).not.toBeNull();

    // Privacy: TinyFish and the model got derived words only, never what Bee transcribed.
    const tinyfishUrls = (fetchImpl.mock.calls as unknown as [string][]).map(([u]) => u).filter((u) => u.includes("tinyfish"));
    expect(tinyfishUrls).toHaveLength(1);
    expect(decodeURIComponent(tinyfishUrls[0]!)).not.toContain("SAID-VERBATIM");
    expect(generateImpl.mock.calls[0]![0].prompt).not.toContain("SAID-VERBATIM");
    expect(generateImpl.mock.calls[0]![0].prompt).not.toContain("Sun Raw");
  });

  it("an ambiguous answer ends with Which one? options (web hits first, the catalogs' earlier ones after), never a match", async () => {
    const earlier: Candidate = { canonicalName: "Love Is", creator: "Jimetta Rose", yearOrAddress: "2019", imageUrl: null, links: {} };
    const id = await addRec({ set: `${NO_MATCH}, match_candidates = '${JSON.stringify([{ provider: "musicbrainz", ...earlier }])}'::jsonb,
      candidates_at = now() - interval '2 minutes', auto_pick = 'none'` });
    const fetchImpl = net({ apple: { MettaSun: "1700", "Sun Ra Tribute": "1800" } });
    const generateImpl = answer([{ title: "MettaSun", creator: "Jimetta Rose", result: 1 }, { title: "Sun Ra Tribute", creator: "Jimetta Rose", result: null }]);
    expect(await sweep({ env: APPLE_ENV, webFind: realWebFind(APPLE_ENV, fetchImpl, generateImpl), onlyIds: [id] }))
      .toMatchObject({ webFinds: 1, webMatched: 0 });

    const m = await row(id);
    expect(m).toMatchObject({ enrichment_status: "no_match", match_source: "auto", canonical_name: "Sun Ra-inspired album" });
    expect(m.match_candidates.map((x: Candidate) => [x.provider, x.canonicalName])).toEqual(
      [["apple", "MettaSun"], ["apple", "Sun Ra Tribute"], ["musicbrainz", "Love Is"]]);
    expect(m.web_looked_at).not.toBeNull();
    // The lane wrote these, not the owner: candidates_at is not later than enriched_at (decision 048's "searched" rule).
    expect(new Date(m.candidates_at).getTime()).toBeLessThanOrEqual(new Date(m.enriched_at).getTime());
  });

  it("no catalog has it: one web option; the owner picking it settles the tip through the Link path", async () => {
    const id = await addRec({ set: NO_MATCH });
    const fetchImpl = net();
    const generateImpl = answer([{ title: "MettaSun", creator: "Jimetta Rose", result: 1 }]);
    await sweep({ env: KEY_ENV, webFind: realWebFind(KEY_ENV, fetchImpl, generateImpl), onlyIds: [id] });
    const m = await row(id);
    expect(m.match_candidates).toEqual([{ provider: "web", canonicalName: "MettaSun", creator: "Jimetta Rose", yearOrAddress: null,
      detail: "jimettarose.bandcamp.com", imageUrl: null, links: { web: PAGE } }]);
    expect((fetchImpl.mock.calls as unknown as [string][]).some(([u]) => u === PAGE)).toBe(false); // never fetched by the sweep

    const page = vi.fn<(u: string) => Promise<Response>>(async () => new Response(
      `<html><head><meta property="og:title" content="MettaSun, by Jimetta Rose"><meta property="og:image" content="https://f4.bcbits.com/img/a1_10.jpg"></head></html>`,
      { status: 200, headers: { "content-type": "text/html" } }));
    const { pickCandidate } = await import("../../agent/lib/recs/which-one");
    expect(await pickCandidate(id, 0, "MettaSun — Jimetta Rose — jimettarose.bandcamp.com",
      { fetchImpl: page as unknown as typeof fetch, lookup: async () => ["93.184.216.34"], apple: null })).toEqual({ changed: true });
    expect(page.mock.calls[0]![0]).toBe(PAGE);
    const p = await row(id);
    expect(p).toMatchObject({ enrichment_status: "matched", match_source: "owner", canonical_name: "MettaSun", creator: "Jimetta Rose",
      image_url: "https://f4.bcbits.com/img/a1_10.jpg", review_reason: null });
    expect(p.links).toEqual({ bandcamp: PAGE });
  });

  it("TINYFISH_API_KEY unset: the web is never searched (exactly today's lane)", async () => {
    const id = await addRec({ set: NO_MATCH });
    const webFind = vi.fn();
    expect(await sweep({ env: {}, webFind, onlyIds: [id] })).toMatchObject({ webFinds: 0 });
    expect(webFind).not.toHaveBeenCalled();
    expect((await row(id)).web_looked_at).toBeNull();
  });

  it("a 429 from TinyFish is retry-later: the tip is untouched, the step stops, and the next run looks", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const first = await addRec({ set: NO_MATCH });
    const second = await addRec({ set: NO_MATCH });
    const generateImpl = answer([{ title: "MettaSun", creator: "Jimetta Rose", result: null }]);
    const busy = net({ tinyfishStatus: 429 });
    expect(await sweep({ env: KEY_ENV, webFind: realWebFind(KEY_ENV, busy, generateImpl), onlyIds: [first, second] })).toMatchObject({ webFinds: 1 });
    expect((busy.mock.calls as unknown as [string][]).filter(([u]) => u.includes("tinyfish"))).toHaveLength(1);
    for (const id of [first, second]) expect(await row(id)).toMatchObject({ web_looked_at: null, enrichment_status: "no_match", match_candidates: null });

    expect(await sweep({ env: KEY_ENV, webFind: realWebFind(KEY_ENV, net(), generateImpl), onlyIds: [first, second] })).toMatchObject({ webFinds: 2 });
    for (const id of [first, second]) expect((await row(id)).web_looked_at).not.toBeNull();
  });

  it("once per tip: a tip already looked for is never searched again; the owner's own search or None of these is left alone", async () => {
    const looked = await addRec({ set: `${NO_MATCH}, web_looked_at = now()` });
    const searched = await addRec({ set: `${NO_MATCH}, match_candidates = '[]'::jsonb, candidates_at = now()` });
    const none = await addRec({ set: `${NO_MATCH}, match_source = 'owner', owner_none_at = now()` });
    const webFind = vi.fn();
    expect(await sweep({ env: KEY_ENV, webFind, onlyIds: [looked, searched, none] })).toMatchObject({ webFinds: 0 });
    expect(webFind).not.toHaveBeenCalled();
  });

  it("at most 3 web lookups a run", async () => {
    const tips = [await addRec({ set: NO_MATCH }), await addRec({ set: NO_MATCH }), await addRec({ set: NO_MATCH }), await addRec({ set: NO_MATCH })];
    const webFind = vi.fn(async () => ({ kind: "nothing" as const }));
    const { MAX_WEB_FINDS_PER_RUN } = await laneMod();
    expect(MAX_WEB_FINDS_PER_RUN).toBe(3);
    expect(await sweep({ env: KEY_ENV, webFind, onlyIds: tips })).toMatchObject({ webFinds: 3 });
    expect(await sweep({ env: KEY_ENV, webFind, onlyIds: tips })).toMatchObject({ webFinds: 1 });
    expect(await sweep({ env: KEY_ENV, webFind, onlyIds: tips })).toMatchObject({ webFinds: 0 });
  });

  it("the owner's fix with new words lets the web look again", async () => {
    const id = await addRec({ set: `${NO_MATCH}, web_looked_at = now()` });
    const { applyTipFix } = await import("../../agent/lib/recs/fix-tip");
    expect(await applyTipFix(id, { name: "MettaSun" })).toMatchObject({ changed: true, requeued: true });
    expect((await row(id)).web_looked_at).toBeNull();
  });
});
