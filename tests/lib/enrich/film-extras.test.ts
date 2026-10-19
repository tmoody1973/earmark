import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchExtras, filmFromTmdb, pickTrailer, readExtras, type ExtrasRec } from "../../../agent/lib/enrich/extras";
import { ProviderHttpError } from "../../../agent/lib/enrich/types";
import { isBackOffSignal } from "../../../agent/lib/recs/lane";

// Real TMDB answers (recorded 2026-10-19 with append_to_response=credits,videos,watch/providers, trimmed): Shōgun (tv
// 126308) and Dune: Part Two (movie 693134). Tests never call the network.
const fx = (name: string) => JSON.parse(readFileSync(`${import.meta.dirname}/../../fixtures/enrich/${name}.json`, "utf8"));
const SHOGUN = fx("tmdb-tv-shogun");
const DUNE = fx("tmdb-movie-dune-part-two");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const rec = (over: Partial<ExtrasRec> = {}): ExtrasRec => ({
  type: "film_tv", canonical_name: "Shōgun", creator: null, apple_music_id: null,
  links: { tmdb: "https://www.themoviedb.org/tv/126308" }, about_url: null, ...over,
});
const logo = (path: string) => `https://image.tmdb.org/t/p/w92${path}`;

afterEach(() => { vi.restoreAllMocks(); });

describe("filmFromTmdb", () => {
  it("a show: synopsis, genres, seasons and episodes, who created it, top 4 cast, US streaming, its trailer", () => {
    const f = filmFromTmdb(SHOGUN, "tv")!;
    expect(f.overview).toMatch(/^In Japan in the year 1600/);
    expect(f).toMatchObject({
      kind: "tv", genres: ["Drama", "War & Politics"], runtime: null, seasons: 1, episodes: 10,
      by: ["Rachel Kondo", "Justin Marks"],
      cast: ["Hiroyuki Sanada", "Cosmo Jarvis", "Anna Sawai", "Tadanobu Asano"],
      watch: {
        link: "https://www.themoviedb.org/tv/126308-shogun/watch?locale=US",
        stream: [{ name: "Disney Plus", logoUrl: logo("/5eZ872CghnHFLB1j8grszbrx0dx.png") },
          { name: "Hulu", logoUrl: logo("/44uAnmSqvA4yBOdbPWN8YgQHjWm.png") }],
        free: [], rentBuy: [],
      },
      trailer: "HIs9x49DK7I", // the first official YouTube Trailer, though teasers come before it
    });
  });

  it("a movie: runtime, directors from the crew, rent and buy merged without repeats", () => {
    const f = filmFromTmdb(DUNE, "movie")!;
    expect(f).toMatchObject({ kind: "movie", genres: ["Science Fiction", "Adventure"], runtime: 167, seasons: null,
      episodes: null, by: ["Denis Villeneuve"], cast: ["Timothée Chalamet", "Zendaya", "Rebecca Ferguson", "Javier Bardem"],
      trailer: "U2Qp5pL3ovA" });
    expect(f.watch!.stream[0]).toEqual({ name: "HBO Max Amazon Channel", logoUrl: logo("/64fLWeSyZ1KQZhIdvTdy4QHeWty.png") });
    const rentBuy = f.watch!.rentBuy.map((p) => p.name);
    expect(rentBuy.slice(0, 3)).toEqual(["Amazon Video", "Apple TV Store", "Google Play Movies"]); // in both lists: once
    expect(new Set(rentBuy).size).toBe(rentBuy.length);
    expect(rentBuy.length).toBeLessThanOrEqual(6);
  });

  it("free and with-ads are one group; another country's providers never show", () => {
    const us = { link: "https://www.themoviedb.org/movie/1/watch?locale=US",
      free: [{ provider_name: "Kanopy", logo_path: "/k.png" }], ads: [{ provider_name: "Tubi TV", logo_path: "/t.jpg" }] };
    expect(filmFromTmdb({ "watch/providers": { results: { US: us } } }, "movie")!.watch).toEqual({ link: us.link, stream: [],
      free: [{ name: "Kanopy", logoUrl: logo("/k.png") }, { name: "Tubi TV", logoUrl: logo("/t.jpg") }], rentBuy: [] });
    expect(filmFromTmdb({ ...DUNE, "watch/providers": { results: { GB: DUNE["watch/providers"].results.GB } } }, "movie")!.watch).toBeNull();
    expect(filmFromTmdb({ ...DUNE, "watch/providers": { results: {} } }, "movie")!.watch).toBeNull();
  });

  it("missing parts are empty, not errors; nothing at all is null", () => {
    expect(filmFromTmdb({ id: 1 }, "movie")).toEqual({ kind: "movie", overview: null, genres: [], runtime: null, seasons: null,
      episodes: null, by: [], cast: [], watch: null, trailer: null });
    expect(filmFromTmdb(null, "tv")).toBeNull();
  });
});

describe("pickTrailer", () => {
  const v = (o: object) => ({ site: "YouTube", type: "Trailer", official: true, key: "aaaaaaaaaaa", ...o });
  it("an official YouTube Trailer first, then a Teaser; other sites, unofficial uploads and odd keys are ignored", () => {
    expect(pickTrailer([v({ type: "Teaser", key: "teaser00001" }), v({ key: "trailer0001" })])).toBe("trailer0001");
    expect(pickTrailer([v({ type: "Clip" }), v({ type: "Teaser", key: "teaser00001" })])).toBe("teaser00001");
    expect(pickTrailer([v({ site: "Vimeo", key: "vimeo000001" }), v({ official: false, key: "fan00000001" })])).toBeNull();
    expect(pickTrailer([v({ key: "not a key" })])).toBeNull();
    expect(pickTrailer(undefined)).toBeNull();
  });
});

describe("fetchExtras for film and TV", () => {
  it("one TMDB request per tip, with credits, videos and providers appended, using the token as Bearer", async () => {
    const fetchImpl = vi.fn(async () => json(SHOGUN));
    const out = await fetchExtras(rec(), fetchImpl as never, null, "tok");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.themoviedb.org/3/tv/126308?append_to_response=credits,videos,watch/providers&language=en-US");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(out.film).toEqual(filmFromTmdb(SHOGUN, "tv"));
  });

  it("reads a movie link (a slug after the id is fine)", async () => {
    const fetchImpl = vi.fn(async () => json(DUNE));
    const out = await fetchExtras(rec({ links: { tmdb: "https://www.themoviedb.org/movie/693134-dune-part-two" } }), fetchImpl as never, null, "tok");
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toMatch(/^https:\/\/api\.themoviedb\.org\/3\/movie\/693134\?/);
    expect(out.film?.kind).toBe("movie");
  });

  it("no token, no TMDB link, or TMDB has no such item: no film, and no request without a token or link", async () => {
    const fetchImpl = vi.fn(async () => json({}, 404));
    expect(await fetchExtras(rec(), fetchImpl as never, null, null)).toEqual({});
    expect(await fetchExtras(rec({ links: { imdb: "https://www.imdb.com/title/tt1" } }), fetchImpl as never, null, "tok")).toEqual({});
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await fetchExtras(rec(), fetchImpl as never, null, "tok")).toEqual({});
  });

  it("a 429 from TMDB throws a back-off signal (the lane stops without counting a try)", async () => {
    const fetchImpl = vi.fn(async () => json({}, 429));
    const err = await fetchExtras(rec(), fetchImpl as never, null, "tok").catch((e) => e);
    expect(err).toBeInstanceOf(ProviderHttpError);
    expect(isBackOffSignal(err)).toBe(true);
  });

  it("only film_tv tips ask TMDB", async () => {
    const fetchImpl = vi.fn(async () => json(SHOGUN));
    await fetchExtras(rec({ type: "other" }), fetchImpl as never, null, "tok");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("readExtras: film", () => {
  it("round trip: what the lane stores is what the page reads", () => {
    for (const [body, kind] of [[SHOGUN, "tv"], [DUNE, "movie"]] as const) {
      const film = filmFromTmdb(body, kind)!;
      expect(readExtras(JSON.parse(JSON.stringify({ film })))).toEqual({ film });
    }
  });

  it("drops what the page must not trust: foreign links and logos, a bad trailer id, a wrong kind", () => {
    const film = filmFromTmdb(DUNE, "movie")!;
    const bad = { ...film, trailer: "javascript:", watch: { ...film.watch!, stream: [{ name: "X", logoUrl: "https://evil.example/x.png" }] } };
    expect(readExtras({ film: bad }).film).toMatchObject({ trailer: null, watch: { stream: [{ name: "X", logoUrl: null }] } });
    expect(readExtras({ film: { ...film, watch: { ...film.watch!, link: "https://evil.example/watch" } } }).film!.watch).toBeNull();
    expect(readExtras({ film: { ...film, kind: "book" } }).film).toBeUndefined();
    expect(readExtras({ film: { ...film, cast: [1, "Zendaya"], genres: "Drama", runtime: -5 } }).film)
      .toMatchObject({ cast: ["Zendaya"], genres: [], runtime: null });
  });
});
