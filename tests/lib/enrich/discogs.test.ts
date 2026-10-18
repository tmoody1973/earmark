import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DISCOGS_GAP_MS, discogsAccess, discogsFacts, fetchDiscogs, hasTrack, MAX_CREDITS, parseRelease, pickCandidates, readDiscogs,
  resetDiscogsSkipLog, resetDiscogsThrottle, logDiscogsSkippedOnce, type DiscogsRec,
} from "../../../agent/lib/enrich/discogs";
import { fetchExtras, readExtras } from "../../../agent/lib/enrich/extras";
import { ProviderHttpError } from "../../../agent/lib/enrich/types";
import { isBackOffSignal } from "../../../agent/lib/recs/lane";

// Shapes follow api.discogs.com (database/search, masters/{id}, releases/{id}, artists search), trimmed. No network.
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const access = { key: "k", secret: "s" };
const NOW = new Date("2026-10-18T12:00:00Z");

const album: DiscogsRec = { type: "album", canonical_name: "Untitled (Black Is)", creator: "Sault" };
const masterSearch = { results: [
  { id: 1, type: "master", title: "Sault (2) - Untitled (Black Is)", cover_image: "https://i.discogs.com/x.jpg" },
  { id: 2, type: "master", title: "Sault (2) - Untitled (Rise)" },
] };
const release = {
  id: 16035051, year: 2020, title: "Untitled (Black Is)",
  labels: [{ name: "Forever Living Originals", catno: "FLO001" }, { name: "Forever Living Originals", catno: "FLO001" }, { name: "Other Co (2)", catno: "none" }],
  formats: [{ name: "Vinyl", qty: "2", descriptions: ["LP", "Album"] }, { name: "CD", descriptions: ["Album"] }],
  genres: ["Funk / Soul", "Electronic"], styles: ["Neo Soul", "Soul"],
  extraartists: [
    { name: "Inflo", role: "Producer" }, { name: "Inflo", role: "Producer" }, { name: "Cleo Sol (3)", role: "Vocals" }, { name: "", role: "Mixed By" }, { name: "Nobody", role: "" },
  ],
  tracklist: [{ title: "Out the Lies" }, { title: "Hard Life (feat. Someone)" }],
};

describe("pickCandidates", () => {
  it("album: title + artist must both match once normalised; Discogs' artist number is ignored", () => {
    expect(pickCandidates(masterSearch, album)).toEqual([1]);
  });
  it("album: no confident match (wrong title, wrong artist, or no creator) picks nothing", () => {
    expect(pickCandidates(masterSearch, { ...album, canonical_name: "Untitled" })).toEqual([]);
    expect(pickCandidates(masterSearch, { ...album, creator: "Sault Band" })).toEqual([]);
    expect(pickCandidates(masterSearch, { ...album, creator: null })).toEqual([]);
    expect(pickCandidates({}, album)).toEqual([]);
  });
  it("artist: one exact name wins; two same-named artists is a guess, so none", () => {
    const rec: DiscogsRec = { type: "artist", canonical_name: "Sault", creator: null };
    expect(pickCandidates({ results: [{ id: 9, title: "Sault (2)" }, { id: 10, title: "Saultan" }] }, rec)).toEqual([9]);
    expect(pickCandidates({ results: [{ id: 9, title: "Sault (2)" }, { id: 11, title: "Sault" }] }, rec)).toEqual([]);
  });
  it("song: keeps releases by the right artist, at most two; the tracklist decides later", () => {
    const rec: DiscogsRec = { type: "song", canonical_name: "Hard Life", creator: "Sault" };
    const res = { results: [{ id: 5, title: "Other - Hard Life" }, { id: 6, title: "Sault (2) - 5" }, { id: 7, title: "Sault (2) - 7" }, { id: 8, title: "Sault (2) - 9" }] };
    expect(pickCandidates(res, rec)).toEqual([6, 7]);
  });
});

describe("hasTrack", () => {
  it("equal or 'name (feat. …)' fits; anything looser does not", () => {
    expect(hasTrack(release, "Hard Life")).toBe(true);
    expect(hasTrack(release, "Out the Lies")).toBe(true);
    expect(hasTrack(release, "Life")).toBe(false);
    expect(hasTrack({}, "Hard Life")).toBe(false);
  });
});

describe("parseRelease", () => {
  it("labels (deduped, catno 'none' dropped), year, formats, tags, credits with full names", () => {
    expect(parseRelease(release, NOW)).toEqual({
      url: "https://www.discogs.com/release/16035051",
      labels: [{ name: "Forever Living Originals", catno: "FLO001" }, { name: "Other Co", catno: null }],
      year: 2020, formats: ["Vinyl", "LP", "Album", "CD"], genres: ["Funk / Soul", "Electronic"], styles: ["Neo Soul", "Soul"],
      credits: [{ name: "Inflo", role: "Producer" }, { name: "Cleo Sol", role: "Vocals" }],
      fetchedAt: NOW.toISOString(),
    });
  });
  it(`caps credits at ${MAX_CREDITS}`, () => {
    const many = { id: 1, extraartists: Array.from({ length: 30 }, (_, i) => ({ name: `Person ${i}`, role: "Guitar" })) };
    expect(parseRelease(many)!.credits).toHaveLength(MAX_CREDITS);
  });
  it("no id is not a release; a bare release has empty parts, not errors", () => {
    expect(parseRelease({ title: "x" })).toBeNull();
    expect(parseRelease({ id: 3, year: 0 }, NOW)).toMatchObject({ labels: [], year: null, formats: [], credits: [] });
  });
});

describe("readDiscogs (the page's trust boundary)", () => {
  it("accepts only our own discogs.com release/artist URL and drops malformed parts", () => {
    expect(readDiscogs({ url: "https://evil.example/release/1" })).toBeNull();
    expect(readDiscogs({ url: "javascript:alert(1)" })).toBeNull();
    expect(readDiscogs({ url: "https://www.discogs.com/release/12", labels: [{ name: 5 }, { name: "L", catno: "C1" }], credits: [{ name: "A" }, { name: "B", role: "Bass" }], year: "1999" }))
      .toMatchObject({ labels: [{ name: "L", catno: "C1" }], credits: [{ name: "B", role: "Bass" }], year: null });
    expect(readDiscogs("nope")).toBeNull();
  });
  it("readExtras carries it through next to the other keys", () => {
    const stored = { videoId: "dQw4w9WgXcQ", discogs: { url: "https://www.discogs.com/release/12", year: 1999 } };
    expect(readExtras(stored)).toMatchObject({ videoId: "dQw4w9WgXcQ", discogs: { url: "https://www.discogs.com/release/12", year: 1999 } });
    expect(readExtras({ discogs: { url: "http://elsewhere/x" } }).discogs).toBeUndefined();
  });
});

describe("discogsFacts (the Credits & label section)", () => {
  it("label with catalog number, year, format, tags once each, credits; nothing at all means no section", () => {
    const facts = discogsFacts({ ...parseRelease(release, NOW)!, styles: ["Soul", "Electronic"] });
    expect(facts!.rows).toEqual([["Label", "Forever Living Originals (FLO001), Other Co"], ["Year", "2020"], ["Format", "Vinyl, LP, Album, CD"]]);
    expect(facts!.tags).toEqual(["Funk / Soul", "Electronic", "Soul"]);
    expect(facts!.credits[0]).toEqual({ name: "Inflo", role: "Producer" });
    expect(discogsFacts(readDiscogs({ url: "https://www.discogs.com/artist/9" })!)).toBeNull(); // an artist: just the link
  });
});

describe("discogsAccess", () => {
  it("needs both; trims; null otherwise", () => {
    expect(discogsAccess({ DISCOGS_KEY: " k ", DISCOGS_SECRET: "s" })).toEqual({ key: "k", secret: "s" });
    expect(discogsAccess({ DISCOGS_KEY: "k" })).toBeNull();
    expect(discogsAccess({})).toBeNull();
  });
});

describe("fetchDiscogs", () => {
  beforeEach(() => { resetDiscogsThrottle(); vi.useFakeTimers({ toFake: ["setTimeout", "Date"] }); });
  afterEach(() => vi.useRealTimers());

  // Runs the call to completion while the fake clock advances.
  const run = async <T>(p: Promise<T>): Promise<T> => {
    const settled = p.then((value) => ({ value }), (error) => ({ error }));
    await vi.runAllTimersAsync();
    const r = await settled;
    if ("error" in r) throw r.error;
    return r.value;
  };

  it("album: search masters, then the master's main release; sends the auth header and an identifying User-Agent", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("/database/search")) return json(masterSearch);
      if (u.endsWith("/masters/1")) return json({ id: 1, main_release: 16035051 });
      if (u.endsWith("/releases/16035051")) return json(release);
      throw new Error(`unexpected ${u}`);
    });
    const got = await run(fetchDiscogs(album, access, fetchImpl as unknown as typeof fetch));
    expect(got).toMatchObject({ url: "https://www.discogs.com/release/16035051", year: 2020 });
    const [searchUrl, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const u = new URL(searchUrl);
    expect(u.origin + u.pathname).toBe("https://api.discogs.com/database/search");
    expect(u.searchParams.get("type")).toBe("master");
    expect(u.searchParams.get("artist")).toBe("Sault");
    expect(u.searchParams.get("release_title")).toBe("Untitled (Black Is)");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Discogs key=k, secret=s");
    expect(headers["User-Agent"]).toMatch(/^Earmark\//);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(got)).not.toContain("cover_image"); // Discogs images are restricted data: never stored
  });

  it("no confident match: nothing is stored and no release is fetched", async () => {
    const fetchImpl = vi.fn(async () => json({ results: [{ id: 2, title: "Someone Else - Other Album" }] }));
    expect(await run(fetchDiscogs(album, access, fetchImpl as unknown as typeof fetch))).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("a search 404/400 is nothing found, not an error", async () => {
    const fetchImpl = vi.fn(async () => json({ message: "x" }, 404));
    expect(await run(fetchDiscogs(album, access, fetchImpl as unknown as typeof fetch))).toBeNull();
  });

  it("song: the first candidate whose tracklist has the song wins", async () => {
    const rec: DiscogsRec = { type: "song", canonical_name: "Hard Life", creator: "Sault" };
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("/database/search")) return json({ results: [{ id: 6, title: "Sault (2) - 5" }, { id: 7, title: "Sault (2) - 7" }] });
      if (u.endsWith("/releases/6")) return json({ id: 6, tracklist: [{ title: "Something else" }] });
      return json({ ...release, id: 7 });
    });
    expect((await run(fetchDiscogs(rec, access, fetchImpl as unknown as typeof fetch)))?.url).toBe("https://www.discogs.com/release/7");
    const none = vi.fn(async (url: string | URL | Request) => String(url).includes("/database/search")
      ? json({ results: [{ id: 6, title: "Sault (2) - 5" }] }) : json({ id: 6, tracklist: [{ title: "Nope" }] }));
    expect(await run(fetchDiscogs(rec, access, none as unknown as typeof fetch))).toBeNull();
  });

  it("artist: the profile link only, from the search (no second call)", async () => {
    const fetchImpl = vi.fn(async () => json({ results: [{ id: 9, title: "Sault (2)" }] }));
    const got = await run(fetchDiscogs({ type: "artist", canonical_name: "Sault", creator: null }, access, fetchImpl as unknown as typeof fetch));
    expect(got).toMatchObject({ url: "https://www.discogs.com/artist/9", credits: [], labels: [] });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("other types are skipped without a call", async () => {
    const fetchImpl = vi.fn();
    expect(await fetchDiscogs({ type: "book", canonical_name: "x", creator: "y" }, access, fetchImpl as unknown as typeof fetch)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("keeps at least the gap between calls (fake timers)", async () => {
    const times: number[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      times.push(Date.now());
      const u = String(url);
      if (u.includes("/database/search")) return json(masterSearch);
      if (u.includes("/masters/")) return json({ id: 1, main_release: 16035051 });
      return json(release);
    });
    await run(fetchDiscogs(album, access, fetchImpl as unknown as typeof fetch));
    expect(times).toHaveLength(3);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(DISCOGS_GAP_MS);
    expect(times[2] - times[1]).toBeGreaterThanOrEqual(DISCOGS_GAP_MS);
  });

  it("429 throws a back-off signal; 500 and 401 throw ordinary errors (a try); neither leaks the keys", async () => {
    for (const [status, backoff] of [[429, true], [500, false], [401, false]] as const) {
      const fetchImpl = vi.fn(async () => json({ message: "k=k secret=s" }, status));
      const err = await run(fetchDiscogs(album, access, fetchImpl as unknown as typeof fetch)).catch((e) => e);
      expect(err).toBeInstanceOf(ProviderHttpError);
      expect(err.status).toBe(status);
      expect(isBackOffSignal(err)).toBe(backoff);
      expect(String(err.message)).not.toMatch(/secret|key=/);
    }
  });
});

describe("fetchExtras with Discogs", () => {
  beforeEach(() => resetDiscogsThrottle());
  const rec = { type: "artist" as const, canonical_name: "Sault", creator: null, apple_music_id: null, links: {}, about_url: null };

  it("adds extras.discogs for music tips when configured; unconfigured is skipped with one log line", async () => {
    const fetchImpl = vi.fn(async () => json({ results: [{ id: 9, title: "Sault (2)" }] })) as unknown as typeof fetch;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    resetDiscogsSkipLog();
    expect((await fetchExtras(rec, fetchImpl, null)).discogs).toBeUndefined();
    await fetchExtras(rec, fetchImpl, null);
    expect(log.mock.calls.filter(([m]) => m === "skipped: discogs not configured")).toHaveLength(1);
    expect(fetchImpl).not.toHaveBeenCalled();
    logDiscogsSkippedOnce(); // already logged: stays quiet
    expect((await fetchExtras(rec, fetchImpl, access)).discogs).toMatchObject({ url: "https://www.discogs.com/artist/9" });
    log.mockRestore();
  });
});
