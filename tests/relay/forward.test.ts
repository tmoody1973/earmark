import { describe, expect, it, vi } from "vitest";
import { forward, toEnvelope } from "../../relay/forward";

describe("toEnvelope", () => {
  it("wraps a typed stream line as {event, ts, data} with the type removed from data", () => {
    const line = JSON.stringify({ type: "new-utterance", conversation_uuid: "u", utterance: { text: "hi" } });
    expect(toEnvelope(line, "2026-10-16T00:00:00.000Z")).toEqual({
      event: "new-utterance", ts: "2026-10-16T00:00:00.000Z", data: { conversation_uuid: "u", utterance: { text: "hi" } },
    });
  });

  it("treats the untyped first line as the connected event", () => {
    expect(toEnvelope('{"timestamp":1792186498745}', "t")).toEqual({ event: "connected", ts: "t", data: { timestamp: 1792186498745 } });
  });

  it("skips blank and non-JSON lines", () => {
    expect(toEnvelope("", "t")).toBeNull();
    expect(toEnvelope("Stream ended.", "t")).toBeNull();
    expect(toEnvelope("[1,2]", "t")).toBeNull();
  });
});

describe("forward", () => {
  const opts = (fetchImpl: typeof fetch) => ({ url: "https://x.test/api/bee/events", secret: "sekrit-value", fetchImpl, log: vi.fn() });

  it("POSTs the envelope with the secret in a header, not the URL", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    const o = opts(fetchImpl);
    await forward('{"timestamp":1}', o);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://x.test/api/bee/events");
    expect((init.headers as Record<string, string>)["x-earmark-key"]).toBe("sekrit-value");
    expect(JSON.parse(init.body as string).event).toBe("connected");
    expect(JSON.stringify(o.log.mock.calls)).not.toContain("sekrit-value");
    expect(o.log).toHaveBeenCalledWith("[relay] connected -> 200");
  });

  it("logs the error name and never throws when the network fails", async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError("fetch failed https://x.test?secret"); }) as unknown as typeof fetch;
    const o = opts(fetchImpl);
    await expect(forward('{"type":"todo-created","todo":{"id":1,"text":"a"}}', o)).resolves.toBeUndefined();
    expect(o.log).toHaveBeenCalledWith("[relay] todo-created failed error=TypeError");
  });
});
