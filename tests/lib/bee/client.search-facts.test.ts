import { describe, expect, it, vi } from "vitest";
import { createBeeClient, KeywordSearchSchema, NeuralSearchSchema } from "../../../agent/lib/bee/client";

// Shapes verified live on Tarik's account (docs/research/bee-api.md §7).
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const client = (fetchImpl: ReturnType<typeof vi.fn>) => createBeeClient({ token: "tok", baseUrl: "https://bee.test", fetchImpl: fetchImpl as never });
const neuralBody = {
  results: [{ id: 812, started_at: 1760500000000, stopped_at: 1760503600000, link: "https://bee.computer/c/812", locations: ["Milwaukee"],
    short_summary: "Talked about AI tools at the station", detailed_summary: "A longer summary of the conversation." }],
  total: 1, timezone: "America/Chicago",
};
const keywordBody = {
  results: [{ id: "f_31", type: "fact", score: 7.2, summary: "Writes The Intersection newsletter", snippet: "Writes The Intersection", title_snippet: "", created_at: 1760000000000, corrections: [] }],
  next_cursor: "", search_mode: "bm25", timezone: "America/Chicago",
};

describe("BeeClient.neuralSearch", () => {
  it("POSTs the query to /v1/search/conversations/neural with the bearer token and parses the result", async () => {
    const fetchImpl = vi.fn(async () => ok(neuralBody));
    const r = await client(fetchImpl).neuralSearch("AI in public radio", { limit: 5 });
    expect(r.results[0]).toMatchObject({ id: 812, short_summary: "Talked about AI tools at the station" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://bee.test/v1/search/conversations/neural");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ query: "AI in public radio", limit: 5 });
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer tok");
  });
});

describe("BeeClient.keywordSearch", () => {
  it("POSTs filter and limit to /v1/search/conversations", async () => {
    const fetchImpl = vi.fn(async () => ok(keywordBody));
    const r = await client(fetchImpl).keywordSearch("AI newsletter", { filter: "facts", limit: 5 });
    expect(r.results[0]).toMatchObject({ id: "f_31", summary: "Writes The Intersection newsletter" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://bee.test/v1/search/conversations");
    expect(JSON.parse(String(init.body))).toEqual({ query: "AI newsletter", filter: "facts", limit: 5 });
  });
});

describe("search schemas", () => {
  it("accept the verified shapes and reject a swapped id type", () => {
    expect(() => NeuralSearchSchema.parse(neuralBody)).not.toThrow();
    expect(() => KeywordSearchSchema.parse(keywordBody)).not.toThrow();
    expect(() => NeuralSearchSchema.parse({ results: [{ id: "812" }] })).toThrow();
  });
});

describe("BeeClient.listFacts", () => {
  it("GETs facts with confirmed and limit", async () => {
    const fetchImpl = vi.fn(async () => ok({ facts: [{ id: 1, text: "Hosts Rhythm Lab", tags: [], created_at: 1, confirmed: true }], next_cursor: null, timezone: "America/Chicago" }));
    const r = await client(fetchImpl).listFacts({ confirmed: true, limit: 50 });
    expect(r.facts[0]!.text).toBe("Hosts Rhythm Lab");
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe("https://bee.test/v1/facts?confirmed=true&limit=50");
  });
  it("throws BeeApiError on a 500", async () => {
    const fetchImpl = vi.fn(async () => new Response("boom", { status: 500 }));
    await expect(client(fetchImpl).listFacts({ confirmed: true })).rejects.toMatchObject({ status: 500 });
  });
});
