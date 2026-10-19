import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import * as eveBee from "../src/index.ts";

describe("eve-bee public surface", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("exports the Bee connection and the triage skill", () => {
    for (const name of [
      "createBeeClient", "BeeApiError", "toDate", "parseBeeEnvelope", "conversationRef", "isJournalComplete",
      "parseEarmarkTrigger", "detectEarmarkTrigger", "triageWindow", "ordered", "SystemicTriageError",
    ]) {
      expect(typeof (eveBee as Record<string, unknown>)[name]).toBe("function");
    }
    for (const name of [
      "KIND_INSTRUCTIONS", "REC_TYPE_INSTRUCTIONS", "JOKING_INSTRUCTIONS", "BROADCAST_INSTRUCTIONS", "CORRECTION_INSTRUCTIONS",
    ]) {
      expect(typeof (eveBee as Record<string, unknown>)[name]).toBe("string");
    }
    expect(Object.keys(eveBee.KIND_CRITERIA).sort()).toEqual(["idea_by_user", "neither", "rec_by_user", "rec_to_user"]);
    expect(Object.keys(eveBee.REC_TYPE_CRITERIA)).toContain("none");
    expect(eveBee.DEFAULT_BEE_API_BASE).toBe("https://api.developer.bee.amazon.dev");
    expect(eveBee.DEFAULT_TRIAGE_MODEL).toBe("typesafe-ai/jev-1.13.0");
  });

  it("exports the types a consumer needs", () => {
    expectTypeOf<eveBee.ItemKind>().toEqualTypeOf<"idea_by_user" | "rec_to_user" | "rec_by_user" | "neither">();
    expectTypeOf<eveBee.TriageResult["recType"]>().toEqualTypeOf<eveBee.RecType | "none">();
    expectTypeOf<eveBee.BeeEvent["event"]>().toBeString();
    expectTypeOf<eveBee.BeeClient["listConversations"]>().toBeFunction();
  });

  it("parses a relay envelope whose utterance text contains quotes", () => {
    const evt = eveBee.parseBeeEnvelope({
      event: "new-utterance",
      data: { utterance: { text: 'She said "try the ramen"', speaker: "Unknown" }, conversation_uuid: "8b0c2a4e-uuid" },
    });
    expect(evt.event).toBe("new-utterance");
  });

  it("works without an app env: an explicit token is sent as Bearer auth", async () => {
    vi.stubEnv("BEE_TOKEN", "");
    const seen: string[] = [];
    const client = eveBee.createBeeClient({
      token: "t0k",
      baseUrl: "https://bee.test",
      fetchImpl: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        seen.push(new Headers(init?.headers).get("authorization") ?? "");
        return Response.json({ id: 1 });
      }) as typeof fetch,
    });
    await client.me();
    expect(seen).toEqual(["Bearer t0k"]);
  });

  it("reads BEE_TOKEN and defaults the base URL when no options are given", async () => {
    vi.stubEnv("BEE_TOKEN", "env-tok");
    vi.stubEnv("BEE_API_BASE", undefined);
    const urls: string[] = [];
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      urls.push(String(input));
      return Response.json({ id: 1 });
    });
    await eveBee.createBeeClient().me();
    spy.mockRestore();
    expect(urls).toEqual(["https://api.developer.bee.amazon.dev/v1/me"]);
  });

  it("fails fast with a clear message when there is no token", () => {
    vi.stubEnv("BEE_TOKEN", "");
    expect(() => eveBee.createBeeClient()).toThrow(/BEE_TOKEN/);
  });
});
