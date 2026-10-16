import { beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "s".repeat(32);
const next = vi.hoisted(() => ({ after: vi.fn() }));
vi.mock("next/server", () => next);
vi.mock("../../../../agent/lib/env", () => ({ getEnv: () => ({ EARMARK_WEBHOOK_SECRET: "s".repeat(32) }) }));
const ingest = vi.hoisted(() => ({ handleBeeEvent: vi.fn(async () => {}) }));
vi.mock("../../../../agent/lib/pipeline/ingest", () => ingest);

import { POST, maxDuration } from "../../../../app/api/bee/events/route";

const post = (key: string | null, body: unknown, raw?: string) =>
  POST(new Request("https://x.test/api/bee/events", {
    method: "POST", body: raw ?? JSON.stringify(body), headers: key === null ? {} : { "x-earmark-key": key },
  }));

// `connected` is ignored by the pipeline (no model or database work): the same event the production smoke test sends.
const EVENT = { event: "connected", data: {} };

beforeEach(() => vi.clearAllMocks());

describe("POST /api/bee/events (production ingress)", () => {
  it("is a 401 with a wrong or missing key, and schedules nothing", async () => {
    expect((await post("wrong", EVENT)).status).toBe(401);
    expect((await post(null, EVENT)).status).toBe(401);
    expect(next.after).not.toHaveBeenCalled();
    expect(ingest.handleBeeEvent).not.toHaveBeenCalled();
  });

  it("acks 200 and defers the work to after(), so the pipeline runs once the response is sent", async () => {
    const res = await post(SECRET, EVENT);
    expect(res.status).toBe(200);
    expect(next.after).toHaveBeenCalledTimes(1);
    // The work was handed to after() as a promise; awaiting it runs the handler exactly once.
    await next.after.mock.calls[0][0];
    expect(ingest.handleBeeEvent).toHaveBeenCalledTimes(1);
  });

  it("rejects the secret in the query string", async () => {
    const res = await POST(new Request(`https://x.test/api/bee/events?key=${SECRET}`, { method: "POST", body: JSON.stringify(EVENT) }));
    expect(res.status).toBe(401);
    expect(next.after).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON with 400 and handles nothing", async () => {
    expect((await post(SECRET, null, "{not json")).status).toBe(400);
    expect(next.after).not.toHaveBeenCalled();
    expect(ingest.handleBeeEvent).not.toHaveBeenCalled();
  });

  it("logs a failing background task by event and error name only, and never throws", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    ingest.handleBeeEvent.mockRejectedValueOnce(new TypeError("transcript words in a message"));
    expect((await post(SECRET, EVENT)).status).toBe(200);
    await expect(next.after.mock.calls[0][0]).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith("[bee] connected failed error=TypeError");
    expect(JSON.stringify(error.mock.calls)).not.toContain("transcript");
    error.mockRestore();
  });

  it("rejects an unrecognized event with 400", async () => {
    expect((await post(SECRET, { event: "nope" })).status).toBe(400);
    expect(ingest.handleBeeEvent).not.toHaveBeenCalled();
  });

  it("allows the function at least 60 s to finish the work after the ack", () => {
    expect(maxDuration).toBeGreaterThanOrEqual(60);
  });
});
