import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool, type PoolClient } from "@neondatabase/serverless";

// Real Neon `test` branch (TEST_DATABASE_URL, never production); skipped when absent. TMDB is faked with the recorded
// fixtures. Every sweep and the script are scoped to this file's rows, so other suites' rows are never touched.
const fx = (name: string) => readFileSync(`${import.meta.dirname}/../fixtures/enrich/${name}.json`, "utf8");

describe.skipIf(!process.env.TEST_DATABASE_URL)("film and TV extras on the Neon test branch", () => {
  let pool: Pool;
  let c: PoolClient;
  const ids: number[] = [];
  const quiet = { summarize: vi.fn(async () => null), beeSummary: vi.fn(async () => null), embedRecs: vi.fn(async () => 0),
    about: vi.fn(async () => null) }; // the web-find step only looks at no-matches: these tips are matched

  // A matched film_tv tip whose about step is done (the extras step's own precondition).
  const filmTip = async (o: { name: string; tmdb: string | null; set?: string }) => {
    const { rows } = await c.query(
      `insert into recommendations (type, raw_text, canonical_name, excerpt, said_at, source, status, confidence, links,
         enrichment_status, about_at)
       values ('film_tv', 'it film', $1, 'it film', now(), 'ambient', 'new', 0.9, $2::jsonb, 'matched', now()) returning id`,
      [o.name, JSON.stringify(o.tmdb ? { tmdb: o.tmdb } : {})]);
    const id = Number(rows[0].id);
    ids.push(id);
    if (o.set) await c.query(`update recommendations set ${o.set} where id = $1`, [id]);
    return id;
  };
  // TMDB answers from the fixtures; every other request (the Neon driver's own HTTP queries) goes out as usual. Stubbing
  // the global (not passing an extras fake) also covers the lane handing env.TMDB_API_KEY to fetchExtras.
  const realFetch = globalThis.fetch;
  const fakeTmdb = () => vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith("https://api.themoviedb.org/")) return realFetch(input, init);
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer tok");
    return new Response(fx(url.includes("/tv/126308") ? "tmdb-tv-shogun" : "tmdb-movie-dune-part-two"), { status: 200 });
  });
  const tmdbCalls = (f: ReturnType<typeof fakeTmdb>) => f.mock.calls.filter(([i]) => String(i).startsWith("https://api.themoviedb.org/")).length;
  const extrasOf = async (id: number) => (await c.query(`select extras, extras_at is not null as looked, extras_tries as tries
    from recommendations where id = $1`, [id])).rows[0];

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    c = await pool.connect();
  });

  afterAll(async () => {
    if (!c) return;
    await c.query(`delete from recommendations where id = any($1::bigint[])`, [ids]);
    c.release();
    await pool.end();
  });

  it("the extras step stores `film` for a film_tv tip, next to what was there (one TMDB request each)", async () => {
    const { sweepRecLane } = await import("../../agent/lib/recs/lane");
    const show = await filmTip({ name: "Shōgun", tmdb: "https://www.themoviedb.org/tv/126308" });
    const movie = await filmTip({ name: "Dune: Part Two", tmdb: "https://www.themoviedb.org/movie/693134" });
    const fetchImpl = fakeTmdb();
    vi.stubGlobal("fetch", fetchImpl);
    try {
      const res = await sweepRecLane({ ...quiet, env: { TMDB_API_KEY: "tok" }, onlyIds: [show, movie] });
      expect(res).toMatchObject({ extras: 2 });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(tmdbCalls(fetchImpl)).toBe(2);
    const s = await extrasOf(show);
    expect(s).toMatchObject({ looked: true, tries: 0, extras: { film: { kind: "tv", seasons: 1, trailer: "HIs9x49DK7I",
      watch: { stream: [{ name: "Disney Plus" }, { name: "Hulu" }] } } } });
    expect((await extrasOf(movie)).extras.film).toMatchObject({ kind: "movie", runtime: 167, by: ["Denis Villeneuve"] });
  });

  it("backfill: a dry run only lists; --yes sends matched film tips without `film` back to the extras step", async () => {
    const { requeueFilmExtras } = await import("../../scripts/requeue-film-extras");
    const WIKI = { wiki: { text: "A show.", url: "https://en.wikipedia.org/wiki/Sh%C5%8Dgun_(2024_TV_series)" } };
    const lacking = await filmTip({ name: "Old show", tmdb: "https://www.themoviedb.org/tv/126308",
      set: `extras = '${JSON.stringify(WIKI)}'::jsonb, extras_at = now(), extras_tries = 2` });
    const has = await filmTip({ name: "Has film", tmdb: "https://www.themoviedb.org/movie/1",
      set: `extras = '{"film":{"kind":"movie"}}'::jsonb, extras_at = now()` });
    const notYet = await filmTip({ name: "Not looked yet", tmdb: "https://www.themoviedb.org/movie/2" }); // the lane will get it
    const noLink = await filmTip({ name: "No TMDB link", tmdb: null, set: `extras = '{}'::jsonb, extras_at = now()` });
    const cleared = await filmTip({ name: "Cleared", tmdb: "https://www.themoviedb.org/movie/3",
      set: `status = 'dismissed', extras = '{}'::jsonb, extras_at = now()` });
    const scope = { scopeRecIds: [lacking, has, notYet, noLink, cleared] };

    expect(await requeueFilmExtras(c, { yes: false }, scope)).toEqual({ requeued: [lacking] });
    expect(await extrasOf(lacking)).toMatchObject({ looked: true, tries: 2 });

    expect(await requeueFilmExtras(c, { yes: true }, scope)).toEqual({ requeued: [lacking] });
    expect(await extrasOf(lacking)).toEqual({ looked: false, tries: 0, extras: WIKI }); // kept: the step merges into it
    for (const id of [has, noLink, cleared]) expect((await extrasOf(id)).looked).toBe(true);

    // …and the next sweep fills it in, keeping the Wikipedia passage
    const { sweepRecLane } = await import("../../agent/lib/recs/lane");
    vi.stubGlobal("fetch", fakeTmdb());
    try {
      await sweepRecLane({ ...quiet, env: { TMDB_API_KEY: "tok" }, onlyIds: [lacking] });
    } finally {
      vi.unstubAllGlobals();
    }
    const after = await extrasOf(lacking);
    expect(after).toMatchObject({ looked: true, extras: { wiki: WIKI.wiki, film: { kind: "tv" } } });
  });
});
