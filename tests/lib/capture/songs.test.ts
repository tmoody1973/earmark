import { beforeEach, describe, expect, it, vi } from "vitest";
import { appleMusicSongId, handleSongCapture } from "../../../agent/lib/capture/songs";

const TOKEN = "s".repeat(40);
beforeEach(() => {
  process.env.EARMARK_CAPTURE_TOKEN = TOKEN;
});
const AM = "https://music.apple.com/us/album/promises/1550583154?i=1550583155";
const post = (body: unknown, token: string | null = TOKEN, contentType = "application/json") =>
  new Request("https://earmark.test/api/capture/song", {
    method: "POST",
    headers: { ...(token === null ? {} : { authorization: `Bearer ${token}` }), "content-type": contentType },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const deps = (over: Record<string, unknown> = {}) => ({
  findConversation: vi.fn(async () => ({ conversationId: 9, summary: "Dinner", windows: [{ text: "Unknown: Ann, this song, you'd love it" }] })),
  pickWindow: vi.fn(async (_c: string, w: unknown[]) => ({ window: w[0], probability: 0.8 })),
  attribute: vi.fn(async () => ({ firstName: "Ann", source: "second_person", excerpt: "this song, you'd love it" })),
  save: vi.fn(async (_rec: Record<string, any>, _opts?: unknown) => ({ id: 77, upgraded: false })), // eslint-disable-line @typescript-eslint/no-explicit-any
  afterCreated: vi.fn((_id: number) => undefined),
  ...over,
});
const good = { title: "Movement 1", artist: "Floating Points", apple_music_url: AM, captured_at: new Date(Date.now() - 60_000).toISOString(), lat: "43.04", lng: "-87.91" };

describe("appleMusicSongId", () => {
  it("reads the ?i= song id from an album URL", () => {
    expect(appleMusicSongId(AM)).toBe("1550583155");
  });
  it("reads the id from a /song/ URL", () => {
    expect(appleMusicSongId("https://music.apple.com/us/song/movement-1/1550583155")).toBe("1550583155");
  });
  it("returns null for other hosts, look-alike hosts or missing URLs", () => {
    expect(appleMusicSongId("https://www.shazam.com/track/123")).toBeNull();
    expect(appleMusicSongId("https://evilmusic.apple.com.example.com/x?i=1")).toBeNull();
    expect(appleMusicSongId("https://notmusic.apple.com/x?i=1")).toBeNull();
    expect(appleMusicSongId(null)).toBeNull();
  });
});

describe("handleSongCapture", () => {
  it("401 without or with the wrong token, before reading the body", async () => {
    expect((await handleSongCapture(post(good, "nope"), deps() as never)).status).toBe(401);
    expect((await handleSongCapture(post(good, null), deps() as never)).status).toBe(401);
    expect((await handleSongCapture(post("not json", null, "text/plain"), deps() as never)).status).toBe(401);
  });
  it("401 when the server token is unset (fails closed)", async () => {
    const saved = process.env.EARMARK_CAPTURE_TOKEN;
    delete process.env.EARMARK_CAPTURE_TOKEN;
    vi.resetModules(); // getEnv caches; load a fresh copy that sees no token
    try {
      const fresh = await import("../../../agent/lib/capture/songs");
      expect((await fresh.handleSongCapture(post(good), deps() as never)).status).toBe(401);
      expect((await fresh.handleSongCapture(post(good, ""), deps() as never)).status).toBe(401);
    } finally {
      process.env.EARMARK_CAPTURE_TOKEN = saved;
    }
  });
  it("415 on a wrong content type or a non-JSON body", async () => {
    expect((await handleSongCapture(post("title=x", TOKEN, "application/x-www-form-urlencoded"), deps() as never)).status).toBe(415);
    expect((await handleSongCapture(post("{not json", TOKEN), deps() as never)).status).toBe(415);
  });
  it.each([
    ["missing title", { artist: "y" }],
    ["empty title", { title: "  " }],
    ["title over 200", { title: "x".repeat(201) }],
    ["artist over 200", { title: "x", artist: "y".repeat(201) }],
    ["http Apple Music link", { title: "x", apple_music_url: "http://music.apple.com/us/album/a/1?i=2" }],
    ["non-Apple link", { title: "x", apple_music_url: "https://evil.example.com/a?i=2" }],
    ["javascript link", { title: "x", apple_music_url: "javascript:alert(1)" }],
    ["bad apple_music_id", { title: "x", apple_music_id: "12ab" }],
    ["unparseable timestamp", { title: "x", captured_at: "yesterday-ish" }],
    ["lat out of range", { title: "x", lat: "91", lng: "10" }],
    ["lng out of range", { title: "x", lat: "10", lng: "181" }],
    ["lat without lng", { title: "x", lat: "10" }],
    ["non-numeric lat", { title: "x", lat: "abc", lng: "1" }],
    ["captured_at over a day in the future", { title: "x", captured_at: new Date(Date.now() + 2 * 86_400_000).toISOString() }],
    ["captured_at over a day in the past", { title: "x", captured_at: new Date(Date.now() - 2 * 86_400_000).toISOString() }],
    ["JSON that is not an object", null],
  ])("400 on %s", async (_n, body) => {
    const d = deps();
    expect((await handleSongCapture(post(body), d as never)).status).toBe(400);
    expect(d.save).not.toHaveBeenCalled();
  });
  it("accepts a title-only payload with empty optional strings (Shortcuts sends blanks)", async () => {
    const d = deps({ findConversation: vi.fn(async () => null) });
    const res = await handleSongCapture(post({ title: "Only Title", artist: "", apple_music_url: "", captured_at: "", lat: "", lng: "" }), d as never);
    expect(res.status).toBe(201);
    expect(d.save.mock.calls[0]![0]).toMatchObject({ canonicalName: "Only Title", creator: null, appleMusicId: null, links: {}, beeConversationId: null });
  });
  it("saves via saveCaptureRec with source song, Apple Music id and the picked window's recommender", async () => {
    const d = deps();
    const res = await handleSongCapture(post(good), d as never);
    expect(res.status).toBe(201);
    expect((await res.json()).message).toBe("Earmarked: Movement 1 — Floating Points (from Ann)");
    expect(d.save.mock.calls[0]![0]).toMatchObject({
      type: "song", canonicalName: "Movement 1", creator: "Floating Points", appleMusicId: "1550583155",
      recommenderName: "Ann", beeConversationId: 9, source: "song", confidence: 1,
      links: { apple_music: AM },
    });
    expect(d.save.mock.calls[0]![1]).toEqual({ recentDuplicateMs: 600_000 });
    expect(d.afterCreated).toHaveBeenCalledWith(77);
  });
  it("prefers an explicit apple_music_id over the one parsed from the URL", async () => {
    const d = deps();
    await handleSongCapture(post({ ...good, apple_music_id: "42" }), d as never);
    expect(d.save.mock.calls[0]![0]).toMatchObject({ appleMusicId: "42" });
  });
  it("ties the rec to no conversation when the picker found no window", async () => {
    const d = deps({ pickWindow: vi.fn(async () => null) });
    await handleSongCapture(post(good), d as never);
    expect(d.attribute).not.toHaveBeenCalled();
    expect(d.save.mock.calls[0]![0]).toMatchObject({ beeConversationId: null, recommenderName: null, attributionSource: "none" });
  });
  it("returns 200 duplicate and schedules nothing when the save reports a recent duplicate", async () => {
    const d = deps({ save: vi.fn(async () => ({ id: 55, upgraded: false, duplicate: true })) });
    const res = await handleSongCapture(post(good), d as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ duplicate: true, id: 55 });
    expect(d.afterCreated).not.toHaveBeenCalled();
  });
  it("accepts a captured_at within a day of now", async () => {
    const d = deps();
    expect((await handleSongCapture(post({ title: "x", captured_at: new Date(Date.now() - 3_600_000).toISOString() }), d as never)).status).toBe(201);
  });
  it("413 when content-length or the real byte size is over 16 KB (measured in bytes)", async () => {
    const d = deps();
    const big = new Request("https://earmark.test/api/capture/song", {
      method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", "content-length": "20000" }, body: JSON.stringify({ title: "x" }),
    });
    expect((await handleSongCapture(big, d as never)).status).toBe(413);
    // 6000 four-byte characters = 24 000 bytes but only 6000 string characters
    expect((await handleSongCapture(post({ title: "x", artist: "😀".repeat(100), apple_music_url: "https://music.apple.com/" + "é".repeat(8000) }), d as never)).status).toBe(413);
    expect(d.save).not.toHaveBeenCalled();
  });
  it.each([
    ["findConversation", { findConversation: vi.fn(async () => { throw new Error("bee down"); }) }],
    ["pickWindow", { pickWindow: vi.fn(async () => { throw new Error("model down"); }) }],
    ["attribute", { attribute: vi.fn(async () => { throw new Error("model down"); }) }],
  ])("still saves, unlinked, when %s throws", async (_n, over) => {
    const d = deps(over);
    const res = await handleSongCapture(post(good), d as never);
    expect(res.status).toBe(201);
    expect(d.save.mock.calls[0]![0]).toMatchObject({ beeConversationId: null, recommenderName: null, attributionSource: "none", excerpt: "", canonicalName: "Movement 1" });
    expect(d.afterCreated).toHaveBeenCalledWith(77);
  });
  it("500 when the save fails, and schedules nothing", async () => {
    const d = deps({ save: vi.fn(async () => { throw new Error("boom"); }) });
    const res = await handleSongCapture(post(good), d as never);
    expect(res.status).toBe(500);
    expect(d.afterCreated).not.toHaveBeenCalled();
  });
  it("still returns 201 when scheduling the after-work throws", async () => {
    const d = deps({ afterCreated: vi.fn(() => { throw new Error("sched"); }) });
    expect((await handleSongCapture(post(good), d as never)).status).toBe(201);
  });
});
