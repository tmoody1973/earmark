import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { coverArtFromJson, coverArtUrl, mbQuery, musicBrainzProvider, resetMusicBrainzThrottle } from "../../../agent/lib/enrich/musicbrainz";
import { runProvider, USER_AGENT, type EnrichQuery } from "../../../agent/lib/enrich/types";

const fx = (f: string) => JSON.parse(readFileSync(`tests/fixtures/enrich/${f}`, "utf8"));
const q = (type: EnrichQuery["type"], name: string, creator: string | null = null): EnrichQuery => ({ type, name, creator, lat: null, lng: null });
const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

beforeEach(() => resetMusicBrainzThrottle()); // each test starts with a free slot; the spacing test below pins the gap
afterEach(() => vi.useRealTimers());

describe("musicBrainzProvider.parse (recorded release-group search)", () => {
  it("reads title, artist credit, year, type and the release-group MBID", () => {
    const [first] = musicBrainzProvider.parse(fx("musicbrainz-release-group-promises.json"), q("album", "Promises", "Floating Points"));
    expect(first!.canonicalName).toMatch(/Promises/);
    expect(first!.creator).toMatch(/Floating Points/);
    expect(first!.yearOrAddress).toMatch(/^\d{4}$/);
    expect(first!.mbid).toMatch(MBID);
    expect(first!.releaseGroupId).toBe(first!.mbid);
    expect(first!.links.musicbrainz).toBe(`https://musicbrainz.org/release-group/${first!.mbid}`);
    expect(first!.imageUrl).toBeNull(); // art comes from the Cover Art Archive, after the match
  });

  it("returns nothing for an empty result set", () => {
    expect(musicBrainzProvider.parse({ count: 0, "release-groups": [] }, q("album", "x"))).toEqual([]);
    expect(musicBrainzProvider.parse({}, q("song", "x"))).toEqual([]);
  });

  // Shapes per https://musicbrainz.org/doc/MusicBrainz_API/Search (recording, artist): no recorded fixture yet.
  it("reads a recording with its first release's release group, and an artist with its disambiguation", () => {
    const [song] = musicBrainzProvider.parse({
      recordings: [{ id: "r1", title: "Song A", disambiguation: "live", "first-release-date": "1999-02-01",
        "artist-credit": [{ name: "Band B", joinphrase: "" }], releases: [{ id: "x", title: "Album C", "release-group": { id: "rg1" } }] }],
    }, q("song", "Song A"));
    expect(song).toMatchObject({ canonicalName: "Song A", creator: "Band B", yearOrAddress: "1999", detail: "live, from Album C",
      mbid: "r1", releaseGroupId: "rg1", links: { musicbrainz: "https://musicbrainz.org/recording/r1" } });
    const [artist] = musicBrainzProvider.parse({
      artists: [{ id: "a1", name: "Band B", disambiguation: "90s indie band", area: { name: "Ohio" } }],
    }, q("artist", "Band B"));
    expect(artist).toMatchObject({ canonicalName: "Band B", creator: null, detail: "90s indie band, Ohio", mbid: "a1",
      links: { musicbrainz: "https://musicbrainz.org/artist/a1" } });
    expect(artist!.releaseGroupId).toBeUndefined();
  });

  it("takes a song's cover art from an original release, never a compilation or DJ mix", () => {
    const rel = (id: string, secondary: string[]) => ({ id: `r-${id}`, title: id, "release-group": { id, "primary-type": "Album", "secondary-types": secondary } });
    const parse = (releases: unknown[]) => musicBrainzProvider.parse({ recordings: [{ id: "r1", title: "S", releases }] }, q("song", "S"))[0]!;
    expect(parse([rel("comp", ["Compilation"]), rel("orig", [])]).releaseGroupId).toBe("orig");
    expect(parse([rel("mix", ["DJ-mix"])]).releaseGroupId).toBeUndefined();
  });
});

describe("musicBrainzProvider.build", () => {
  it("searches the right entity with escaped Lucene terms, JSON and a contact User-Agent", async () => {
    const { url, init } = await musicBrainzProvider.build(q("album", "Promises: Live!", "Floating Points"));
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://musicbrainz.org/ws/2/release-group");
    expect(u.searchParams.get("fmt")).toBe("json");
    expect(u.searchParams.get("query")).toBe(
      'releasegroup:"Promises\\: Live\\!"^2 releasegroup:(Promises\\: Live\\!) artist:(Floating~ Points~)',
    );
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe(USER_AGENT);
    expect(USER_AGENT).toMatch(/^Earmark\/[\d.]+ \( https:\/\/\S+ \)$/);
  });

  it("maps song → recording and artist → artist, and refuses non-music types", async () => {
    expect(new URL((await musicBrainzProvider.build(q("song", "A", "B"))).url).pathname).toBe("/ws/2/recording");
    resetMusicBrainzThrottle();
    expect(new URL((await musicBrainzProvider.build(q("artist", "Salt"))).url).searchParams.get("query")).toBe('artist:"Salt"^2 artist:(Salt~)');
    await expect(musicBrainzProvider.build(q("book", "A"))).rejects.toThrow(/not a music type/);
  });

  it("spaces requests at least one second apart (MusicBrainz: 1 request/second per IP)", async () => {
    vi.useFakeTimers();
    const t0 = Date.now();
    const times: number[] = [];
    const runs = [0, 1, 2].map(() => musicBrainzProvider.build(q("artist", "A")).then(() => times.push(Date.now() - t0)));
    await vi.runAllTimersAsync();
    await Promise.all(runs);
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(1000);
    expect(times[2]! - times[1]!).toBeGreaterThanOrEqual(1000);
  });
});

describe("runProvider", () => {
  const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("returns at most three parsed candidates and passes a timeout signal", async () => {
    const fetchImpl = vi.fn(async (_u: string, init: RequestInit) => { expect(init.signal).toBeInstanceOf(AbortSignal); return ok(fx("musicbrainz-release-group-promises.json")); });
    const out = await runProvider(musicBrainzProvider, q("album", "Promises", "Floating Points"), fetchImpl as never);
    expect(out.length).toBeLessThanOrEqual(3);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("treats 404 as no match and throws a named error (no body, no retry) on other failures", async () => {
    expect(await runProvider(musicBrainzProvider, q("artist", "A"), (async () => ok({}, 404)) as never)).toEqual([]);
    resetMusicBrainzThrottle();
    const fetchImpl = vi.fn(async () => ok({ error: "secret payload" }, 503));
    const err = await runProvider(musicBrainzProvider, q("artist", "A"), fetchImpl as never).then(() => null, (e: unknown) => e as Error & { status?: number });
    if (!err) throw new Error("expected a failure");
    expect(err.name).toBe("ProviderHttpError");
    expect(err.status).toBe(503);
    expect(err.message).not.toContain("secret");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("Cover Art Archive", () => {
  it("reads the front 500px thumbnail as https from the recorded release-group listing", () => {
    const url = coverArtFromJson(fx("coverartarchive-release-group-promises.json"));
    expect(url).toMatch(/^https:\/\/.*500/);
  });

  it("is null when there is no front image", () => {
    expect(coverArtFromJson({ images: [{ front: false, thumbnails: { 500: "http://a/b-500.jpg" } }] })).toBeNull();
    expect(coverArtFromJson({})).toBeNull();
  });

  it("fetches by release-group id; 404 → null", async () => {
    const fetchImpl = vi.fn(async (u: string) => {
      expect(u).toBe("https://coverartarchive.org/release-group/rg1");
      return new Response("", { status: 404 });
    });
    expect(await coverArtUrl("rg1", fetchImpl as never)).toBeNull();
  });
});

describe("mbQuery", () => {
  const SPECIAL = 'a+b-c&&d||e!(f){g}[h]^i"j~k*l?m:n\\o/p';
  const ESCAPED = 'a\\+b\\-c\\&\\&d\\|\\|e\\!\\(f\\)\\{g\\}\\[h\\]\\^i\\"j\\~k\\*l\\?m\\:n\\\\o\\/p';

  it("escapes every Lucene special character", () => {
    expect(mbQuery(q("album", SPECIAL))).toBe(`releasegroup:"${ESCAPED}"^2 releasegroup:(${ESCAPED})`);
  });

  it("keeps the artist optional and fuzzy only on plain 4+ letter words (mishearings: Salt → SAULT)", () => {
    expect(mbQuery(q("album", "Acts of Faith", "Salt"))).toBe('releasegroup:"Acts of Faith"^2 releasegroup:(Acts of Faith) artist:(Salt~)');
    expect(mbQuery(q("song", "x", "The AC/DC"))).toBe('recording:"x"^2 recording:(x) artist:(The AC\\/DC)');
  });
});
