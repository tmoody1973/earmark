import { describe, expect, it, vi } from "vitest";
import { handleRelayRequest, secretMatches } from "../../../agent/lib/bee/webhook";

const SECRET = "s".repeat(64);
const body = JSON.stringify({ event: "new-utterance", ts: "t", data: { utterance: { text: "hi", speaker: "Unknown" }, conversation_uuid: "u" } });
const req = (key: string | null, payload: string = body) =>
  new Request(`http://localhost:2000/api/bee/events${key === null ? "" : `?key=${key}`}`, { method: "POST", body: payload });

describe("secretMatches", () => {
  it("accepts the exact secret and rejects others", () => {
    expect(secretMatches(SECRET, SECRET)).toBe(true);
    expect(secretMatches(SECRET.slice(1), SECRET)).toBe(false);
    expect(secretMatches(null, SECRET)).toBe(false);
    expect(secretMatches("", SECRET)).toBe(false);
    expect(secretMatches(SECRET + "x", SECRET)).toBe(false); // unequal length must not throw
    expect(secretMatches("x".repeat(64), SECRET)).toBe(false);
  });
});

describe("handleRelayRequest", () => {
  it("returns 401 without the right key and does not process", async () => {
    const handle = vi.fn(async () => {});
    const res = await handleRelayRequest(req("wrong"), { secret: SECRET, waitUntil: vi.fn(), handle });
    expect(res.status).toBe(401);
    expect(handle).not.toHaveBeenCalled();
  });

  it("returns 400 on invalid JSON", async () => {
    const res = await handleRelayRequest(req(SECRET, "{not json"), { secret: SECRET, waitUntil: vi.fn(), handle: vi.fn() });
    expect(res.status).toBe(400);
  });

  it("returns 400 on an unknown event shape", async () => {
    const res = await handleRelayRequest(req(SECRET, JSON.stringify({ event: "mystery", data: {} })), {
      secret: SECRET, waitUntil: vi.fn(), handle: vi.fn(),
    });
    expect(res.status).toBe(400);
  });

  it("acks 200 immediately even when processing never finishes", async () => {
    const never = new Promise<void>(() => {});
    const handle = vi.fn(() => never);
    const waitUntil = vi.fn();
    const started = Date.now();
    const res = await handleRelayRequest(req(SECRET), { secret: SECRET, waitUntil, handle });
    expect(res.status).toBe(200);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(handle).toHaveBeenCalledOnce();
    expect(waitUntil).toHaveBeenCalledOnce();
  });

  it("responds while the handler promise is still pending", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let bg: Promise<unknown> = Promise.resolve();
    const res = await handleRelayRequest(req(SECRET), { secret: SECRET, waitUntil: (p) => { bg = p; }, handle: () => gate });
    let settled = false;
    void bg.then(() => { settled = true; });
    await Promise.resolve();
    expect(res.status).toBe(200);
    expect(settled).toBe(false);
    release();
    await bg;
    expect(settled).toBe(true);
  });

  it("logs a synchronous handler throw instead of failing the response", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let pending: Promise<unknown> = Promise.resolve();
    const res = await handleRelayRequest(req(SECRET), {
      secret: SECRET,
      waitUntil: (p) => { pending = p; },
      handle: () => { throw new TypeError("sync boom transcript words"); },
    });
    await pending;
    expect(res.status).toBe(200);
    expect(error).toHaveBeenCalledWith("[bee] new-utterance failed error=TypeError"); // name only: messages can echo transcript text
    expect(JSON.stringify(error.mock.calls)).not.toContain("transcript");
    error.mockRestore();
  });

  it("logs processing errors instead of throwing", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let pending: Promise<unknown> = Promise.resolve();
    const res = await handleRelayRequest(req(SECRET), {
      secret: SECRET,
      waitUntil: (p) => { pending = p; },
      handle: async () => { throw new Error("Bee 500 transcript words"); },
    });
    await pending;
    expect(res.status).toBe(200);
    expect(error).toHaveBeenCalledWith("[bee] new-utterance failed error=Error");
    expect(JSON.stringify(error.mock.calls)).not.toContain("transcript");
    error.mockRestore();
  });
});
