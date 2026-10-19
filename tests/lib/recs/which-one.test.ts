import { generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetMusicBrainzThrottle } from "../../../agent/lib/enrich/musicbrainz";
import { providerFor } from "../../../agent/lib/enrich/registry";
import { searchCandidates } from "../../../agent/lib/recs/which-one";

// Search again's lookup (decision 048), without the database: MusicBrainz first, Apple when it finds nothing (decision 050).
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const APPLE_ENV = { APPLE_TEAM_ID: "T", APPLE_MUSIC_KEY_ID: "K",
  APPLE_MUSIC_PRIVATE_KEY: generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
const MB = { "release-groups": [{ id: "rg-1", title: "Night Garden", "primary-type": "Album", "artist-credit": [{ name: "Mara Vell", joinphrase: "" }] }] };
const METTA = { results: { albums: { data: [{ id: "1700", attributes: { name: "MettaSun", artistName: "Jimetta Rose",
  url: "https://music.apple.com/us/album/1700", artwork: { url: "https://is1/{w}x{h}.jpg" } } }] } } };
const q = (name: string) => ({ type: "album" as const, name, creator: null, lat: null, lng: null });
const routed = (mb: unknown, apple: () => Response) => vi.fn(async (u: string) =>
  u.startsWith("https://musicbrainz.org/") ? json(mb) : u.startsWith("https://api.music.apple.com/") ? apple() : json({}, 404));
const hosts = (f: ReturnType<typeof vi.fn>) => (f.mock.calls as unknown as [string][]).map(([u]) => new URL(u).host);

beforeEach(() => resetMusicBrainzThrottle());

describe("searchCandidates", () => {
  const mb = providerFor("album", {})!;

  it("music: MusicBrainz empty → Apple's catalog, stored with provider 'apple' and Apple's id, link and art", async () => {
    const fetchImpl = routed({ "release-groups": [] }, () => json(METTA));
    const found = await searchCandidates(mb, q("MettaSun"), APPLE_ENV, fetchImpl as never);
    expect(found).toEqual([expect.objectContaining({ provider: "apple", canonicalName: "MettaSun", appleMusicId: "1700",
      links: { apple_music: "https://music.apple.com/us/album/1700" }, imageUrl: "https://is1/600x600.jpg" })]);
    expect(hosts(fetchImpl)).toEqual(["musicbrainz.org", "api.music.apple.com"]);
  });

  it("music: MusicBrainz found something → only MusicBrainz, stored as musicbrainz", async () => {
    const fetchImpl = routed(MB, () => json(METTA));
    const found = await searchCandidates(mb, q("Night Garden"), APPLE_ENV, fetchImpl as never);
    expect(found.map((c) => [c.provider, c.canonicalName])).toEqual([["musicbrainz", "Night Garden"]]);
    expect(hosts(fetchImpl)).toEqual(["musicbrainz.org"]);
  });

  it("music without Apple configured: MusicBrainz only, as today", async () => {
    const fetchImpl = routed({ "release-groups": [] }, () => json(METTA));
    expect(await searchCandidates(mb, q("MettaSun"), {}, fetchImpl as never)).toEqual([]);
    expect(hosts(fetchImpl)).toEqual(["musicbrainz.org"]);
  });

  it("an Apple 429 throws to Search again's caller (\"try again in a bit\"), as any provider's does", async () => {
    const fetchImpl = routed({ "release-groups": [] }, () => json({}, 429));
    await expect(searchCandidates(mb, q("MettaSun"), APPLE_ENV, fetchImpl as never)).rejects.toMatchObject({ name: "ProviderHttpError", status: 429 });
  });

  it("other types never ask Apple", async () => {
    const fetchImpl = vi.fn(async () => json({ docs: [] }));
    expect(await searchCandidates(providerFor("book", {})!, { ...q("Night Garden"), type: "book" }, APPLE_ENV, fetchImpl as never)).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
