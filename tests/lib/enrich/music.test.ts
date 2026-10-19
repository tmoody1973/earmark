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

// Decision 050: when Apple is configured, MusicBrainz and Apple's catalog are searched together on every music lookup;
// the same release from both is one candidate; Jev picks once among the merged list, same bar.
describe("enrichMusic with Apple alongside MusicBrainz", () => {
  const APPLE_ACCESS = { token: async () => "tok", storefront: "us" };
  const appleAlbum = (id: string, name: string, artistName: string) => ({ id, attributes: { name, artistName, releaseDate: "2026-09-01",
    url: `https://music.apple.com/us/album/${id}`, artwork: { url: `https://is1/${id}/{w}x{h}.jpg` } } });
  const apple = (...data: unknown[]) => ({ results: { albums: { data } } });
  const METTA = apple(appleAlbum("1700", "MettaSun", "Jimetta Rose"));
  const mettaInput = { ...input, query: { ...input.query, name: "MettaSun", creator: "Jimetta Rose" }, described: "MettaSun by Jimetta Rose" };
  const routed = (mb: () => Response, ap: () => Response, caa: () => Response = () => json(CAA)) => vi.fn(async (u: string) =>
    u.startsWith("https://musicbrainz.org/") ? mb() : u.startsWith("https://api.music.apple.com/") ? ap() : caa());
  const calls = (f: ReturnType<typeof vi.fn>, prefix: string) => (f.mock.calls as unknown as [string][]).filter(([u]) => u.startsWith(prefix));
  const shown = (pick: ReturnType<typeof vi.fn>) => (pick.mock.calls[0]![1] as Candidate[]).map((c) => `${c.provider ?? "-"}:${c.canonicalName}`);

  it("an Apple-only release (MettaSun): Jev picks it once; Apple's id, link and art, no Cover Art call", async () => {
    const fetchImpl = routed(() => json({ "release-groups": [] }), () => json(METTA));
    const pick = vi.fn(pickFirst);
    const m = await enrichMusic(mettaInput, { fetchImpl: fetchImpl as never, pick, apple: APPLE_ACCESS });
    expect(m).toMatchObject({ canonicalName: "MettaSun", creator: "Jimetta Rose", yearOrAddress: "2026", appleMusicId: "1700", provider: "apple",
      links: { apple_music: "https://music.apple.com/us/album/1700" }, imageUrl: "https://is1/1700/600x600.jpg", matchConfidence: 0.9 });
    expect(m!.mbid).toBeUndefined();
    expect(pick).toHaveBeenCalledTimes(1);
    expect(pick.mock.calls[0]![0]).toEqual({ described: "MettaSun by Jimetta Rose", excerpt: EXCERPT, name: "MettaSun", creator: "Jimetta Rose" });
    expect(calls(fetchImpl, "https://api.music.apple.com/")).toHaveLength(1);
    expect(calls(fetchImpl, "https://coverartarchive.org/")).toHaveLength(0);
  });

  it("the same release from both: one merged candidate with both identities; no second Apple search after the pick", async () => {
    const fetchImpl = routed(() => json(MB), () => json(apple(appleAlbum("155", "Night Garden", "Mara Vell"))));
    const pick = vi.fn(pickFirst);
    const m = await enrichMusic(input, { fetchImpl: fetchImpl as never, pick, apple: APPLE_ACCESS });
    expect(shown(pick)).toEqual(["musicbrainz+apple:Night Garden"]);
    expect(m).toMatchObject({ mbid: "rg-1", releaseGroupId: "rg-1", appleMusicId: "155", imageUrl: "https://is1/155/600x600.jpg",
      links: { musicbrainz: "https://musicbrainz.org/release-group/rg-1", apple_music: "https://music.apple.com/us/album/155" } });
    expect(calls(fetchImpl, "https://api.music.apple.com/")).toHaveLength(1);
    expect(calls(fetchImpl, "https://coverartarchive.org/")).toHaveLength(0); // art already there: CAA only fills a gap
  });

  it("a MusicBrainz-only release: Cover Art Archive art, and the Apple add-on still looks for its twin by the matched name", async () => {
    const fetchImpl = routed(() => json(MB), () => json(apple()));
    const m = await enrichMusic(input, { fetchImpl: fetchImpl as never, pick: pickFirst, apple: APPLE_ACCESS });
    expect(m).toMatchObject({ mbid: "rg-1", imageUrl: "https://coverartarchive.org/release/r/1-500.jpg" });
    expect(m!.appleMusicId).toBeUndefined();
    expect(calls(fetchImpl, "https://api.music.apple.com/")).toHaveLength(2); // the search, then the add-on
  });

  it("orders Jev's list merged first, then MusicBrainz and Apple alternating, at most MAX_CANDIDATES", async () => {
    const rg = (id: string, title: string, artist: string) => ({ id, title, "primary-type": "Album", "artist-credit": [{ name: artist, joinphrase: "" }] });
    const mb = { "release-groups": [rg("rg-a", "Alpha", "Mara Vell"), rg("rg-b", "Bravo", "Mara Vell"), rg("rg-n", "Night Garden", "Mara Vell")] };
    const ap = apple(appleAlbum("1", "Charlie", "Mara Vell"), appleAlbum("2", "Night Garden", "Mara Vell"), appleAlbum("3", "Delta", "Mara Vell"));
    const pick = vi.fn(async () => null);
    await enrichMusic(input, { fetchImpl: routed(() => json(mb), () => json(ap)) as never, pick, apple: APPLE_ACCESS });
    expect(shown(pick)).toEqual(["musicbrainz+apple:Night Garden", "-:Alpha", "apple:Charlie"]);
  });

  it("Jev abstains on the merged list → null", async () => {
    const fetchImpl = routed(() => json({ "release-groups": [] }), () => json(METTA));
    expect(await enrichMusic(mettaInput, { fetchImpl: fetchImpl as never, pick: async () => null, apple: APPLE_ACCESS })).toBeNull();
  });

  it("MusicBrainz fails, Apple found something: Apple's candidates are used and the failure is logged (ids, error name)", async () => {
    const fetchImpl = routed(() => json({}, 503), () => json(METTA));
    const m = await enrichMusic(mettaInput, { fetchImpl: fetchImpl as never, pick: pickFirst, apple: APPLE_ACCESS });
    expect(m).toMatchObject({ appleMusicId: "1700" });
    expect(logs).toContain("[enrich] musicbrainz failed rec=42 error=ProviderHttpError status=503");
  });

  it("MusicBrainz fails and Apple found nothing: the MusicBrainz error is thrown (the lane's retry/back-off, as today)", async () => {
    const fetchImpl = routed(() => json({}, 503), () => json(apple()));
    await expect(enrichMusic(mettaInput, { fetchImpl: fetchImpl as never, pick: pickFirst, apple: APPLE_ACCESS }))
      .rejects.toMatchObject({ name: "ProviderHttpError", host: "musicbrainz.org", status: 503 });
  });

  it("Apple fails, MusicBrainz found something: MusicBrainz's candidates are used and the failure is logged", async () => {
    const boom = () => { throw Object.assign(new Error(`boom ${EXCERPT}`), { name: "TimeoutError" }); };
    const fetchImpl = routed(() => json(MB), boom);
    const m = await enrichMusic(input, { fetchImpl: fetchImpl as never, pick: pickFirst, apple: APPLE_ACCESS });
    expect(m).toMatchObject({ mbid: "rg-1" });
    expect(logs).toContain("[enrich] apple-music failed rec=42 error=TimeoutError");
    expect(logs.join("\n")).not.toContain("SECRET-TRANSCRIPT");
    expect(logs.join("\n")).not.toContain("boom");
  });

  it("Apple fails and MusicBrainz found nothing: the Apple error is thrown, so the lane retries rather than settling no_match", async () => {
    const fetchImpl = routed(() => json({ "release-groups": [] }), () => json({}, 503));
    await expect(enrichMusic(mettaInput, { fetchImpl: fetchImpl as never, pick: pickFirst, apple: APPLE_ACCESS }))
      .rejects.toMatchObject({ name: "ProviderHttpError", host: "api.music.apple.com", status: 503 });
  });

  it("Apple not configured: MusicBrainz only, as today", async () => {
    const fetchImpl = routed(() => json({ "release-groups": [] }), () => json(METTA));
    expect(await enrichMusic(mettaInput, { fetchImpl: fetchImpl as never, pick: pickFirst, apple: null })).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
