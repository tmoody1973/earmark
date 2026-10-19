import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAppleSkipLog } from "../../../agent/lib/enrich/apple-music";
import { enrichMusic } from "../../../agent/lib/enrich/music";
import { resetMusicBrainzThrottle } from "../../../agent/lib/enrich/musicbrainz";
import type { Candidate, EnrichmentMatch } from "../../../agent/lib/enrich/types";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const MB = { "release-groups": [{ id: "rg-1", title: "Night Garden", "first-release-date": "2021", "primary-type": "Album",
  "artist-credit": [{ name: "Mara Vell", joinphrase: "" }] }] };
const CAA = { images: [{ front: true, thumbnails: { 500: "http://coverartarchive.org/release/r/1-500.jpg" } }] };
const EXCERPT = "SECRET-TRANSCRIPT you have to hear Night Garden";
const input = { recId: 42, query: { type: "album" as const, name: "Night Garden", creator: "Mara Vell", lat: null, lng: null },
  described: "Night Garden by Mara Vell", excerpt: EXCERPT };
const pickFirst = vi.fn(async (_i: unknown, cs: readonly Candidate[]): Promise<EnrichmentMatch | null> => (cs[0] ? { ...cs[0], matchConfidence: 0.9 } : null));

let logs: string[];
beforeEach(() => {
  resetMusicBrainzThrottle();
  resetAppleSkipLog();
  logs = [];
  for (const m of ["log", "warn", "error", "info"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { logs.push(a.join(" ")); });
});
afterEach(() => vi.restoreAllMocks());

describe("enrichMusic", () => {
  it("MusicBrainz identity → Jev pick → Cover Art Archive art; Apple skipped with one log line when unconfigured", async () => {
    const fetchImpl = vi.fn(async (u: string) => (u.startsWith("https://musicbrainz.org/") ? json(MB) : json(CAA)));
    const m = await enrichMusic(input, { fetchImpl: fetchImpl as never, pick: pickFirst, apple: null });
    expect(m).toMatchObject({ canonicalName: "Night Garden", mbid: "rg-1", matchConfidence: 0.9,
      imageUrl: "https://coverartarchive.org/release/r/1-500.jpg", links: { musicbrainz: "https://musicbrainz.org/release-group/rg-1" } });
    expect(m!.appleMusicId).toBeUndefined();
    resetMusicBrainzThrottle();
    await enrichMusic(input, { fetchImpl: fetchImpl as never, pick: pickFirst, apple: null });
    expect(logs.filter((l) => l === "skipped: apple music not configured")).toHaveLength(1);
  });

  it("returns null without art lookups when Jev abstains", async () => {
    const fetchImpl = vi.fn(async () => json(MB));
    expect(await enrichMusic(input, { fetchImpl: fetchImpl as never, pick: async () => null, apple: null })).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("keeps the match when cover art fails, logging ids and the error name only", async () => {
    const fetchImpl = vi.fn(async (u: string) => {
      if (u.startsWith("https://musicbrainz.org/")) return json(MB);
      throw Object.assign(new Error(`boom ${EXCERPT}`), { name: "TimeoutError" });
    });
    const m = await enrichMusic(input, { fetchImpl: fetchImpl as never, pick: pickFirst, apple: null });
    expect(m).toMatchObject({ mbid: "rg-1", imageUrl: null, artRetry: "rg-1" }); // the lane retries art later
    const line = logs.find((l) => l.includes("cover-art"))!;
    expect(line).toContain("rec=42");
    expect(line).toContain("mbid=rg-1");
    expect(line).toContain("TimeoutError");
    expect(logs.join("\n")).not.toContain("SECRET-TRANSCRIPT");
    expect(logs.join("\n")).not.toContain("boom");
  });

  it("a release group with no art (404) is final: no art retry", async () => {
    const fetchImpl = vi.fn(async (u: string) => (u.startsWith("https://musicbrainz.org/") ? json(MB) : json({}, 404)));
    const m = await enrichMusic(input, { fetchImpl: fetchImpl as never, pick: pickFirst, apple: null });
    expect(m).toMatchObject({ imageUrl: null });
    expect(m!.artRetry).toBeUndefined();
  });

  it("propagates a MusicBrainz failure (the lane decides retry), without logging the excerpt", async () => {
    const fetchImpl = vi.fn(async () => json({}, 503));
    await expect(enrichMusic(input, { fetchImpl: fetchImpl as never, pick: pickFirst, apple: null })).rejects.toMatchObject({ name: "ProviderHttpError" });
    expect(logs.join("\n")).not.toContain("SECRET-TRANSCRIPT");
  });

  it("adds an Apple Music link when configured and Apple's top result is the same name and artist", async () => {
    const apple = { results: { albums: { data: [{ id: "155", attributes: { name: "Night Garden", artistName: "Mara Vell",
      url: "https://music.apple.com/us/album/155", artwork: { url: "https://is1/{w}x{h}.jpg" } } }] } } };
    const fetchImpl = vi.fn(async (u: string) =>
      u.startsWith("https://musicbrainz.org/") ? json(MB) : u.startsWith("https://api.music.apple.com/") ? json(apple) : json({}, 404));
    const m = await enrichMusic(input, { fetchImpl: fetchImpl as never, pick: pickFirst, apple: { token: async () => "tok", storefront: "us" } });
    expect(m).toMatchObject({ appleMusicId: "155", links: { apple_music: "https://music.apple.com/us/album/155", musicbrainz: "https://musicbrainz.org/release-group/rg-1" },
      imageUrl: "https://is1/600x600.jpg" }); // no CAA art (404) → Apple artwork fills in
    const appleCall = (fetchImpl.mock.calls as unknown as [string, RequestInit][]).find(([u]) => u.startsWith("https://api.music.apple.com/"))!;
    expect(appleCall[1].headers).toMatchObject({ Authorization: "Bearer tok" });
  });

  it("does not attach an Apple result for a different artist", async () => {
    const apple = { results: { albums: { data: [{ id: "9", attributes: { name: "Night Garden", artistName: "Tribute Band", url: "https://music.apple.com/us/album/9" } }] } } };
    const fetchImpl = vi.fn(async (u: string) =>
      u.startsWith("https://musicbrainz.org/") ? json(MB) : u.startsWith("https://api.music.apple.com/") ? json(apple) : json(CAA));
    const m = await enrichMusic(input, { fetchImpl: fetchImpl as never, pick: pickFirst, apple: { token: async () => "tok", storefront: "us" } });
    expect(m!.appleMusicId).toBeUndefined();
    expect(m!.links.apple_music).toBeUndefined();
  });
});

// Decision 050: MusicBrainz has nothing (or Jev abstains on all of it) → Apple Music's catalog, same Jev pick, same bar.
describe("enrichMusic Apple fallback", () => {
  const APPLE_ACCESS = { token: async () => "tok", storefront: "us" };
  const METTA = { results: { albums: { data: [{ id: "1700", attributes: { name: "MettaSun", artistName: "Jimetta Rose", releaseDate: "2026-09-01",
    url: "https://music.apple.com/us/album/1700", artwork: { url: "https://is1/{w}x{h}.jpg" } } }] } } };
  const mettaInput = { ...input, query: { ...input.query, name: "MettaSun", creator: "Jimetta Rose" }, described: "MettaSun by Jimetta Rose" };
  const routed = (mb: unknown, apple: () => Response) => vi.fn(async (u: string) =>
    u.startsWith("https://musicbrainz.org/") ? json(mb) : u.startsWith("https://api.music.apple.com/") ? apple() : json(CAA));
  const appleCalls = (f: ReturnType<typeof vi.fn>) => (f.mock.calls as unknown as [string][]).filter(([u]) => u.startsWith("https://api.music.apple.com/"));

  it("MusicBrainz empty → Apple searched → Jev's pick is the match, with Apple's id, link and art and no Cover Art call", async () => {
    const fetchImpl = routed({ "release-groups": [] }, () => json(METTA));
    const pick = vi.fn(pickFirst);
    const m = await enrichMusic(mettaInput, { fetchImpl: fetchImpl as never, pick, apple: APPLE_ACCESS });
    expect(m).toMatchObject({ canonicalName: "MettaSun", creator: "Jimetta Rose", yearOrAddress: "2026", appleMusicId: "1700",
      links: { apple_music: "https://music.apple.com/us/album/1700" }, imageUrl: "https://is1/600x600.jpg", provider: "apple", matchConfidence: 0.9 });
    expect(m!.mbid).toBeUndefined();
    expect(appleCalls(fetchImpl)).toHaveLength(1); // the fallback only: no add-on search on top
    expect(fetchImpl.mock.calls.some(([u]) => String(u).includes("coverartarchive"))).toBe(false);
    expect(pick).toHaveBeenCalledTimes(2);
    expect(pick.mock.calls[1]![0]).toEqual({ described: "MettaSun by Jimetta Rose", excerpt: EXCERPT }); // same pick, same input
  });

  it("MusicBrainz has an accepted pick → no fallback; the Apple add-on runs once, as before", async () => {
    const apple = { results: { albums: { data: [{ id: "155", attributes: { name: "Night Garden", artistName: "Mara Vell", url: "https://music.apple.com/us/album/155" } }] } } };
    const fetchImpl = routed(MB, () => json(apple));
    const pick = vi.fn(pickFirst);
    const m = await enrichMusic(input, { fetchImpl: fetchImpl as never, pick, apple: APPLE_ACCESS });
    expect(m).toMatchObject({ mbid: "rg-1", appleMusicId: "155" });
    expect(m!.provider).toBeUndefined();
    expect(pick).toHaveBeenCalledTimes(1);
    expect(appleCalls(fetchImpl)).toHaveLength(1);
  });

  it("MusicBrainz candidates but Jev abstains → Apple searched and Jev asked again among Apple's", async () => {
    const fetchImpl = routed(MB, () => json(METTA));
    const pick = vi.fn(async (_i: unknown, cs: readonly Candidate[]) => (cs[0]?.provider === "apple" ? { ...cs[0], matchConfidence: 0.85 } : null));
    const m = await enrichMusic(input, { fetchImpl: fetchImpl as never, pick, apple: APPLE_ACCESS });
    expect(m).toMatchObject({ appleMusicId: "1700", provider: "apple", matchConfidence: 0.85 });
    expect(pick.mock.calls.map(([, cs]) => cs.map((c) => c.canonicalName))).toEqual([["Night Garden"], ["MettaSun"]]);
  });

  it("Jev abstains on Apple's too → null", async () => {
    const fetchImpl = routed({ "release-groups": [] }, () => json(METTA));
    expect(await enrichMusic(mettaInput, { fetchImpl: fetchImpl as never, pick: async () => null, apple: APPLE_ACCESS })).toBeNull();
  });

  it("Apple not configured → null as today, one MusicBrainz call", async () => {
    const fetchImpl = routed({ "release-groups": [] }, () => json(METTA));
    expect(await enrichMusic(mettaInput, { fetchImpl: fetchImpl as never, pick: pickFirst, apple: null })).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("an Apple error during the fallback → null for this try, logged with ids and the error name only", async () => {
    for (const fail of [() => json({}, 503), () => { throw Object.assign(new Error(`boom ${EXCERPT}`), { name: "TimeoutError" }); }]) {
      resetMusicBrainzThrottle();
      logs = [];
      const fetchImpl = routed({ "release-groups": [] }, fail);
      expect(await enrichMusic(mettaInput, { fetchImpl: fetchImpl as never, pick: pickFirst, apple: APPLE_ACCESS })).toBeNull();
      const line = logs.find((l) => l.includes("apple-music"))!;
      expect(line).toMatch(/^\[enrich\] apple-music failed rec=42 error=(ProviderHttpError status=503|TimeoutError)$/);
    }
    expect(logs.join("\n")).not.toContain("SECRET-TRANSCRIPT");
  });
});
