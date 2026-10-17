import { beforeEach, describe, expect, it, vi } from "vitest";
import { bearerMatches, safeEqual } from "../../../agent/lib/capture/auth";
import { handlePhotoCapture } from "../../../agent/lib/capture/photos";

const TOKEN = "t".repeat(40);
beforeEach(() => {
  process.env.EARMARK_CAPTURE_TOKEN = TOKEN;
});

function req(form: FormData, token: string | null = TOKEN, query = "") {
  return new Request(`https://earmark.test/api/capture/photo${query}`, {
    method: "POST",
    headers: token === null ? {} : { authorization: `Bearer ${token}` },
    body: form,
  });
}
function photoForm(withThumb = true) {
  const f = new FormData();
  f.set("image", new File([new Uint8Array([0xff, 0xd8, 0xff])], "a.jpg", { type: "image/jpeg" }));
  if (withThumb) f.set("thumb", new File([new Uint8Array([1])], "t.jpg", { type: "image/jpeg" }));
  f.set("taken_at", "2026-10-18T19:00:00Z");
  f.set("lat", "43.04");
  f.set("lng", "-87.91");
  return f;
}
const WINDOW = { text: "Unknown: Ann, you have to hear Promises" };
function deps(over: Record<string, unknown> = {}) {
  return {
    classify: vi.fn(async () => ({ itemProbability: 0.9, recType: "album", recTypeProbability: 0.9, personProbability: 0.01 })),
    read: vi.fn(async () => ({ title: "Promises", creator: "Floating Points", visibleText: "" })),
    findConversation: vi.fn(async () => ({ conversationId: 7, summary: "Dinner", windows: [WINDOW] })),
    pickWindow: vi.fn(async (_c: string, w: unknown[]) => ({ window: w[0], probability: 0.9 })),
    attribute: vi.fn(async () => ({ firstName: "Ann", source: "second_person", excerpt: "you have to hear Promises" })),
    save: vi.fn(async (_rec: Record<string, any>) => ({ id: 42, upgraded: false })), // eslint-disable-line @typescript-eslint/no-explicit-any
    putThumb: vi.fn(async () => "https://blob.test/thumbs/x.jpg"),
    deleteThumb: vi.fn(async (_url: string) => undefined),
    afterCreated: vi.fn((_id: number) => undefined),
    ...over,
  };
}

describe("bearer auth", () => {
  it("compares in constant time and only accepts the exact token", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(bearerMatches(new Request("https://x.test", { headers: { authorization: `Bearer ${TOKEN}` } }), TOKEN)).toBe(true);
    expect(bearerMatches(new Request("https://x.test"), TOKEN)).toBe(false);
  });
});

describe("handlePhotoCapture", () => {
  it("rejects a missing or wrong bearer token", async () => {
    expect((await handlePhotoCapture(req(photoForm(), "wrong"), deps() as never)).status).toBe(401);
    expect((await handlePhotoCapture(req(photoForm(), null), deps() as never)).status).toBe(401);
  });
  it("dry run echoes field names and types without processing", async () => {
    const d = deps();
    const res = await handlePhotoCapture(req(photoForm(), TOKEN, "?dry=1"), d as never);
    const body = await res.json();
    expect(body.fields.image.type).toBe("file");
    expect(body.fields.taken_at.value).toBe("2026-10-18T19:00:00Z");
    expect(d.classify).not.toHaveBeenCalled();
  });
  it("creates a rec linked to the conversation with the window's recommender, then schedules the rec lane", async () => {
    const d = deps();
    const res = await handlePhotoCapture(req(photoForm()), d as never);
    expect(res.status).toBe(201);
    expect(d.save.mock.calls[0][0]).toMatchObject({
      type: "album", canonicalName: "Promises", creator: "Floating Points", attributionSource: "second_person",
      recommenderName: "Ann", beeConversationId: 7, source: "photo",
      photo: { conversationId: 7, thumbnailUrl: "https://blob.test/thumbs/x.jpg" },
    });
    expect(d.afterCreated).toHaveBeenCalledWith(42);
    expect((await res.json()).message).toBe("Earmarked: Promises (from Ann)");
  });
  it("hands the rec-lane work to the injected defer (route passes Next's after)", async () => {
    const { afterCreated: _drop, ...d } = deps();
    const defer = vi.fn();
    expect((await handlePhotoCapture(req(photoForm()), d as never, defer)).status).toBe(201);
    expect(defer).toHaveBeenCalledTimes(1);
    expect(typeof defer.mock.calls[0][0]).toBe("function");
  });
  it("never stores an image when a person may be in it", async () => {
    const d = deps({ classify: vi.fn(async () => ({ itemProbability: 0.9, recType: "album", recTypeProbability: 0.9, personProbability: 0.35 })) });
    await handlePhotoCapture(req(photoForm()), d as never);
    expect(d.putThumb).not.toHaveBeenCalled();
    expect(d.save.mock.calls[0][0].photo.thumbnailUrl).toBeNull();
    expect(d.save.mock.calls[0][0].imageUrl).toBeNull();
  });
  it("ignores photos with no readable item", async () => {
    const d = deps({ classify: vi.fn(async () => ({ itemProbability: 0.2, recType: "other", recTypeProbability: 0.5, personProbability: 0 })) });
    const res = await handlePhotoCapture(req(photoForm()), d as never);
    expect((await res.json()).status).toBe("ignored");
    expect(d.save).not.toHaveBeenCalled();
  });
  it("stores with no recommender when no conversation is near", async () => {
    const d = deps({ findConversation: vi.fn(async () => null) });
    await handlePhotoCapture(req(photoForm()), d as never);
    expect(d.save.mock.calls[0][0]).toMatchObject({ recommenderName: null, attributionSource: "none", excerpt: "", beeConversationId: null });
  });
  it("rejects a missing, oversized or unsupported image", async () => {
    const none = new FormData();
    expect((await handlePhotoCapture(req(none), deps() as never)).status).toBe(400);
    const big = new FormData();
    big.set("image", new File([new Uint8Array(4 * 1024 * 1024 + 1)], "a.jpg", { type: "image/jpeg" }));
    expect((await handlePhotoCapture(req(big), deps() as never)).status).toBe(413);
    const gif = new FormData();
    gif.set("image", new File([new Uint8Array([1])], "a.gif", { type: "image/gif" }));
    expect((await handlePhotoCapture(req(gif), deps() as never)).status).toBe(415);
  });
  it("ties the rec to the conversation only when the picker picked a window; the photos row keeps the link", async () => {
    const d = deps({ pickWindow: vi.fn(async () => null) });
    const res = await handlePhotoCapture(req(photoForm()), d as never);
    expect(res.status).toBe(201);
    const saved = d.save.mock.calls[0][0];
    expect(saved.beeConversationId).toBeNull();
    expect(saved.recommenderName).toBeNull();
    expect(saved.photo.conversationId).toBe(7);
    expect(d.attribute).not.toHaveBeenCalled();
  });
  it("validates the thumb: type and size", async () => {
    const bad = photoForm();
    bad.set("thumb", new File([new Uint8Array([1])], "t.gif", { type: "image/gif" }));
    expect((await handlePhotoCapture(req(bad), deps() as never)).status).toBe(400);
    const big = photoForm();
    big.set("thumb", new File([new Uint8Array(512 * 1024 + 1)], "t.jpg", { type: "image/jpeg" }));
    const d = deps();
    expect((await handlePhotoCapture(req(big), d as never)).status).toBe(413);
    expect(d.classify).not.toHaveBeenCalled();
  });
  it("keeps the thumbnail and still answers 201 when scheduling the rec lane throws after a good save", async () => {
    const d = deps({ afterCreated: vi.fn((_id: number) => { throw new Error("no request scope"); }) });
    const res = await handlePhotoCapture(req(photoForm()), d as never);
    expect(res.status).toBe(201);
    expect(d.deleteThumb).not.toHaveBeenCalled();
  });
  it("answers 415 to a body that is not multipart", async () => {
    const r = new Request("https://earmark.test/api/capture/photo", {
      method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: "{}",
    });
    expect((await handlePhotoCapture(r, deps() as never)).status).toBe(415);
  });
  it("fails closed (401) when no capture token is configured", async () => {
    const saved = process.env.EARMARK_CAPTURE_TOKEN;
    delete process.env.EARMARK_CAPTURE_TOKEN;
    vi.resetModules(); // getEnv caches; load a fresh copy that sees no token
    try {
      const fresh = await import("../../../agent/lib/capture/photos");
      expect((await fresh.handlePhotoCapture(req(photoForm(), ""), deps() as never)).status).toBe(401);
      expect((await fresh.handlePhotoCapture(req(photoForm(), "anything"), deps() as never)).status).toBe(401);
    } finally {
      process.env.EARMARK_CAPTURE_TOKEN = saved;
    }
  });
  it.each([
    ["findConversation", { findConversation: vi.fn(async () => { throw new Error("bee down"); }) }],
    ["pickWindow", { pickWindow: vi.fn(async () => { throw new Error("model down"); }) }],
    ["attribute", { attribute: vi.fn(async () => { throw new Error("model down"); }) }],
  ])("still saves, unlinked, when %s throws", async (_n, over) => {
    const d = deps(over);
    const res = await handlePhotoCapture(req(photoForm()), d as never);
    expect(res.status).toBe(201);
    expect(d.save.mock.calls[0]![0]).toMatchObject({ beeConversationId: null, recommenderName: null, attributionSource: "none", excerpt: "" });
    expect(d.save.mock.calls[0]![0].photo.conversationId).toBeNull();
    expect(d.afterCreated).toHaveBeenCalledWith(42);
  });
  it("still fails the request when classification throws (nothing to save)", async () => {
    const d = deps({ classify: vi.fn(async () => { throw new Error("model down"); }) });
    expect((await handlePhotoCapture(req(photoForm()), d as never)).status).toBe(500);
    expect(d.save).not.toHaveBeenCalled();
  });
  it("deletes the uploaded thumbnail when the save fails, and answers 500 without detail", async () => {
    const d = deps({ save: vi.fn(async (_rec: unknown) => { throw new Error("db down with secret text"); }) });
    const res = await handlePhotoCapture(req(photoForm()), d as never);
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("secret");
    expect(d.deleteThumb).toHaveBeenCalledWith("https://blob.test/thumbs/x.jpg");
    expect(d.afterCreated).not.toHaveBeenCalled();
  });
});
