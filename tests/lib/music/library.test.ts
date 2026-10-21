import { generateKeyPairSync, randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sql = vi.fn();
vi.mock("../../../agent/lib/db", () => ({ db: () => sql }));
import { encryptToken } from "../../../agent/lib/music/crypto";
import {
  addRecToPlaylist, addTipsToPlaylist, appleUserFetch, ensureEarmarkedPlaylist, MAX_PLAYLIST_ADDS_PER_RUN, MusicAuthError,
  parseAlbumFirstSongId, parseTopSongId, REVOKED, songIdsForRec, type AppleCtx,
} from "../../../agent/lib/music/library";
import { ProviderHttpError } from "../../../agent/lib/enrich/types";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const ctx = (fetchImpl: typeof fetch): AppleCtx => ({ devToken: "dev", userToken: "user", storefront: "us", fetchImpl });
const KEY = randomBytes(32).toString("base64");
const ENV = {
  APPLE_TEAM_ID: "TEAM123456", APPLE_MUSIC_KEY_ID: "KEY1234567", APPLE_MUSIC_STOREFRONT: "us", MUSIC_TOKEN_KEY: KEY,
  APPLE_MUSIC_PRIVATE_KEY: generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ type: "pkcs8", format: "pem" }) as string,
};
// The sql text of call i (tagged template: strings first), to tell queries apart.
const text = (i: number) => (sql.mock.calls[i]![0] as string[]).join("?");

beforeEach(() => { sql.mockReset(); });

describe("parsing Apple's answers", () => {
  it("an album's first song, skipping music videos", () => {
    const body = { data: [{ id: "1", relationships: { tracks: { data: [
      { id: "v1", type: "music-videos" }, { id: "s1", type: "songs" }, { id: "s2", type: "songs" },
    ] } } }] };
    expect(parseAlbumFirstSongId(body)).toBe("s1");
    expect(parseAlbumFirstSongId({ data: [] })).toBeNull();
    expect(parseAlbumFirstSongId(null)).toBeNull();
  });
  it("an artist's top song, or null", () => {
    expect(parseTopSongId({ data: [{ id: "t1", type: "songs" }] })).toBe("t1");
    expect(parseTopSongId({ data: [] })).toBeNull();
  });
});

describe("appleUserFetch", () => {
  it("sends the developer token and the owner's token", async () => {
    const fetchImpl = vi.fn(async () => json({ data: [] }));
    await appleUserFetch("/me/library/playlists", {}, ctx(fetchImpl as unknown as typeof fetch));
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.music.apple.com/v1/me/library/playlists");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer dev");
    expect(headers["Music-User-Token"]).toBe("user");
  });
  it("401 and 403 mean the sign-in is gone", async () => {
    for (const status of [401, 403]) {
      const fetchImpl = vi.fn(async () => new Response("no", { status }));
      await expect(appleUserFetch("/me/library/playlists", {}, ctx(fetchImpl as unknown as typeof fetch))).rejects.toBeInstanceOf(MusicAuthError);
    }
  });
  it("any other failure is a ProviderHttpError with its status; 204 is null", async () => {
    const busy = vi.fn(async () => new Response("", { status: 503 }));
    await expect(appleUserFetch("/x", {}, ctx(busy as unknown as typeof fetch))).rejects.toMatchObject({ status: 503 });
    await expect(appleUserFetch("/x", {}, ctx(busy as unknown as typeof fetch))).rejects.toBeInstanceOf(ProviderHttpError);
    const none = vi.fn(async () => new Response(null, { status: 204 }));
    expect(await appleUserFetch("/x", { method: "POST" }, ctx(none as unknown as typeof fetch))).toBeNull();
  });
});

describe("songIdsForRec", () => {
  it("a song is its own id, no request", async () => {
    const fetchImpl = vi.fn();
    expect(await songIdsForRec({ type: "song", apple_music_id: "77" }, ctx(fetchImpl as unknown as typeof fetch))).toEqual(["77"]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("an album adds its first song (one track per tip)", async () => {
    const fetchImpl = vi.fn<(u: string) => Promise<Response>>(async () => json({ data: [{ relationships: { tracks: { data: [{ id: "s1", type: "songs" }, { id: "s2", type: "songs" }] } } }] }));
    expect(await songIdsForRec({ type: "album", apple_music_id: "123" }, ctx(fetchImpl as unknown as typeof fetch))).toEqual(["s1"]);
    expect(String(fetchImpl.mock.calls[0]![0])).toBe("https://api.music.apple.com/v1/catalog/us/albums/123?include=tracks");
  });
  it("an artist adds its top song", async () => {
    const fetchImpl = vi.fn<(u: string) => Promise<Response>>(async () => json({ data: [{ id: "t9", type: "songs" }] }));
    expect(await songIdsForRec({ type: "artist", apple_music_id: "55" }, ctx(fetchImpl as unknown as typeof fetch))).toEqual(["t9"]);
    expect(String(fetchImpl.mock.calls[0]![0])).toContain("/catalog/us/artists/55/view/top-songs?limit=1");
  });
  it("nothing for a non-music tip, a missing id or an id that isn't digits", async () => {
    const fetchImpl = vi.fn();
    const c = ctx(fetchImpl as unknown as typeof fetch);
    expect(await songIdsForRec({ type: "book", apple_music_id: "1" }, c)).toEqual([]);
    expect(await songIdsForRec({ type: "song", apple_music_id: null }, c)).toEqual([]);
    expect(await songIdsForRec({ type: "album", apple_music_id: "../me" }, c)).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("ensureEarmarkedPlaylist", () => {
  it("finds an existing Earmarked playlist across pages and creates nothing", async () => {
    const fetchImpl = vi.fn(async (url: string) => (url.endsWith("offset=100")
      ? json({ data: [{ id: "p.found", attributes: { name: "Earmarked" } }] })
      : json({ data: [{ id: "p.other", attributes: { name: "Gym" } }], next: "/v1/me/library/playlists?offset=100" })));
    expect(await ensureEarmarkedPlaylist(ctx(fetchImpl as unknown as typeof fetch))).toBe("p.found");
    expect(fetchImpl.mock.calls.every((c) => !(c as unknown as [string, RequestInit])[1].method)).toBe(true);
  });
  it("creates it once when missing", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => (init?.method === "POST"
      ? json({ data: [{ id: "p.new" }] }, 201) : json({ data: [] })));
    expect(await ensureEarmarkedPlaylist(ctx(fetchImpl as unknown as typeof fetch))).toBe("p.new");
    const posts = fetchImpl.mock.calls.filter((c) => c[1]?.method === "POST");
    expect(posts).toHaveLength(1);
    expect(JSON.parse(String(posts[0]![1]!.body))).toMatchObject({ attributes: { name: "Earmarked" } });
  });
});

describe("addTipsToPlaylist (the lane step)", () => {
  const connected = (playlist: string | null = "p.1") => [{ user_token_enc: encryptToken("user-token", KEY), playlist_id: playlist }];

  it("not signed in: one read, no Apple call", async () => {
    sql.mockResolvedValueOnce([]);
    const fetchImpl = vi.fn();
    expect(await addTipsToPlaylist({ env: ENV, fetchImpl: fetchImpl as unknown as typeof fetch })).toEqual({ added: 0, state: "not_connected" });
    expect(sql).toHaveBeenCalledTimes(1);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("revoked (no_auth): no Apple call until the owner reconnects", async () => {
    sql.mockResolvedValueOnce([{ user_token_enc: REVOKED, playlist_id: "p.1" }]);
    const fetchImpl = vi.fn();
    expect(await addTipsToPlaylist({ env: ENV, fetchImpl: fetchImpl as unknown as typeof fetch })).toEqual({ added: 0, state: "no_auth" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("no key or no Apple developer secrets: skipped, no Apple call", async () => {
    sql.mockResolvedValue(connected());
    const fetchImpl = vi.fn();
    expect((await addTipsToPlaylist({ env: { ...ENV, MUSIC_TOKEN_KEY: "" }, fetchImpl: fetchImpl as unknown as typeof fetch })).state).toBe("not_configured");
    expect((await addTipsToPlaylist({ env: { ...ENV, APPLE_TEAM_ID: "" }, fetchImpl: fetchImpl as unknown as typeof fetch })).state).toBe("not_configured");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("adds each due tip once, capped per run, and asks only for visible song/album tips", async () => {
    sql.mockResolvedValueOnce(connected())
      .mockResolvedValueOnce([{ id: "5", type: "song", apple_music_id: "77" }]) // due
      .mockResolvedValueOnce([{ id: "5" }]); // claimed
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    expect(await addTipsToPlaylist({ env: ENV, fetchImpl: fetchImpl as unknown as typeof fetch })).toEqual({ added: 1, state: "connected" });
    const due = sql.mock.calls[1]!;
    expect(due.slice(1)).toContain(MAX_PLAYLIST_ADDS_PER_RUN);
    expect(text(1)).toMatch(/added_to_playlist_at is null/);
    expect(due.slice(1)).toContainEqual(["dismissed", "composted", "needs_review", "overheard"]);
    expect(text(2)).toMatch(/set added_to_playlist_at = now\(\)[\s\S]*added_to_playlist_at is null/); // the claim: never twice
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.music.apple.com/v1/me/library/playlists/p.1/tracks");
    expect(JSON.parse(String(init.body))).toEqual({ data: [{ id: "77", type: "songs" }] });
    expect(sql).toHaveBeenCalledTimes(3); // nothing to undo
  });
  it("a 403 marks the sign-in revoked, gives the tip back, and stops the run", async () => {
    sql.mockResolvedValueOnce(connected())
      .mockResolvedValueOnce([{ id: "5", type: "song", apple_music_id: "77" }, { id: "6", type: "song", apple_music_id: "78" }])
      .mockResolvedValue([{ id: "5" }]);
    const fetchImpl = vi.fn(async () => new Response("", { status: 403 }));
    expect(await addTipsToPlaylist({ env: ENV, fetchImpl: fetchImpl as unknown as typeof fetch })).toEqual({ added: 0, state: "no_auth" });
    expect(fetchImpl).toHaveBeenCalledTimes(1); // tip 6 never tried
    const texts = sql.mock.calls.map((_, i) => text(i));
    expect(texts.some((t) => /set added_to_playlist_at = null/.test(t))).toBe(true);
    const revoke = sql.mock.calls.find((c) => (c[0] as string[]).join("?").includes("update music_auth"));
    expect(revoke!.slice(1)).toContain(REVOKED);
  });
  it("any other failure counts a try for that tip and the next tip still runs; a 503 stops the step", async () => {
    sql.mockResolvedValueOnce(connected())
      .mockResolvedValueOnce([{ id: "5", type: "album", apple_music_id: "1" }, { id: "6", type: "song", apple_music_id: "78" }])
      .mockResolvedValue([{ id: "x" }]);
    const fetchImpl = vi.fn(async (url: string) => (url.includes("/catalog/") ? new Response("", { status: 500 }) : new Response(null, { status: 204 })));
    expect(await addTipsToPlaylist({ env: ENV, fetchImpl: fetchImpl as unknown as typeof fetch })).toEqual({ added: 1, state: "connected" });
    expect(sql.mock.calls.some((c) => (c[0] as string[]).join("?").includes("jsonb_build_object('playlistTries'"))).toBe(true);

    sql.mockReset();
    sql.mockResolvedValueOnce(connected())
      .mockResolvedValueOnce([{ id: "5", type: "song", apple_music_id: "77" }, { id: "6", type: "song", apple_music_id: "78" }])
      .mockResolvedValue([{ id: "x" }]);
    const busy = vi.fn(async () => new Response("", { status: 503 }));
    expect((await addTipsToPlaylist({ env: ENV, fetchImpl: busy as unknown as typeof fetch })).added).toBe(0);
    expect(busy).toHaveBeenCalledTimes(1);
    expect(sql.mock.calls.some((c) => (c[0] as string[]).join("?").includes("jsonb_build_object('playlistTries'"))).toBe(false); // not the tip's fault
  });
  it("creates the playlist on first use and remembers it", async () => {
    sql.mockResolvedValueOnce(connected(null)).mockResolvedValueOnce([]).mockResolvedValue([]);
    const fetchImpl = vi.fn(async (_u: string, init?: RequestInit) => (init?.method === "POST" ? json({ data: [{ id: "p.new" }] }, 201) : json({ data: [] })));
    await addTipsToPlaylist({ env: ENV, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).not.toHaveBeenCalled(); // nothing due: no playlist needed yet

    sql.mockReset();
    sql.mockResolvedValueOnce(connected(null)).mockResolvedValueOnce([{ id: "5", type: "song", apple_music_id: "77" }]).mockResolvedValue([{ id: "5" }]);
    fetchImpl.mockImplementation(async (url: string, init?: RequestInit) => (url.endsWith("/tracks") ? new Response(null, { status: 204 })
      : init?.method === "POST" ? json({ data: [{ id: "p.new" }] }, 201) : json({ data: [] })));
    expect((await addTipsToPlaylist({ env: ENV, fetchImpl: fetchImpl as unknown as typeof fetch })).added).toBe(1);
    const saved = sql.mock.calls.find((c) => (c[0] as string[]).join("?").includes("set playlist_id"));
    expect(saved!.slice(1)).toContain("p.new");
  });
});

describe("addRecToPlaylist (the MCP/Alexa ask)", () => {
  it("already added, not music, no Apple id, not connected", async () => {
    sql.mockResolvedValueOnce([{ id: 1, type: "song", apple_music_id: "7", added_to_playlist_at: new Date() }]);
    expect(await addRecToPlaylist(1, { env: ENV })).toBe("already");
    sql.mockResolvedValueOnce([{ id: 1, type: "book", apple_music_id: null, added_to_playlist_at: null }]);
    expect(await addRecToPlaylist(1, { env: ENV })).toBe("not_music");
    sql.mockResolvedValueOnce([{ id: 1, type: "album", apple_music_id: null, added_to_playlist_at: null }]);
    expect(await addRecToPlaylist(1, { env: ENV })).toBe("no_match");
    sql.mockResolvedValueOnce([{ id: 1, type: "album", apple_music_id: "9", added_to_playlist_at: null }]).mockResolvedValueOnce([]);
    expect(await addRecToPlaylist(1, { env: ENV })).toBe("not_connected");
    sql.mockResolvedValueOnce([{ id: 1, type: "album", apple_music_id: "9", added_to_playlist_at: null }])
      .mockResolvedValueOnce([{ user_token_enc: REVOKED, playlist_id: null }]);
    expect(await addRecToPlaylist(1, { env: ENV })).toBe("no_auth");
  });
  it("adds an artist's top song when asked", async () => {
    sql.mockResolvedValueOnce([{ id: 3, type: "artist", apple_music_id: "55", added_to_playlist_at: null }])
      .mockResolvedValueOnce([{ user_token_enc: encryptToken("user-token", KEY), playlist_id: "p.1" }])
      .mockResolvedValue([{ id: 3 }]);
    const fetchImpl = vi.fn(async (url: string) => (url.endsWith("/tracks") ? new Response(null, { status: 204 }) : json({ data: [{ id: "t9", type: "songs" }] })));
    expect(await addRecToPlaylist(3, { env: ENV, fetchImpl: fetchImpl as unknown as typeof fetch })).toBe("added");
  });
});

// Keeps the lane's error type check honest: MusicAuthError is its own class, never a ProviderHttpError.
it("MusicAuthError is named for logs", () => {
  expect(new MusicAuthError("x").name).toBe("MusicAuthError");
});
