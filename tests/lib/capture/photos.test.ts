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
  it("deletes the uploaded thumbnail when the save fails, and answers 500 without detail", async () => {
    const d = deps({ save: vi.fn(async (_rec: unknown) => { throw new Error("db down with secret text"); }) });
    const res = await handlePhotoCapture(req(photoForm()), d as never);
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("secret");
    expect(d.deleteThumb).toHaveBeenCalledWith("https://blob.test/thumbs/x.jpg");
    expect(d.afterCreated).not.toHaveBeenCalled();
  });
});
