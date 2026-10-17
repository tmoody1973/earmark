import { describe, expect, it, vi } from "vitest";
import { BeeApiError, createBeeClient, toDate } from "../../../agent/lib/bee/client";

function fakeFetch(status: number, body: unknown) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), { status }),
  );
}

const opts = (fetchImpl: ReturnType<typeof fakeFetch>) => ({
  token: "tok",
  baseUrl: "https://bee.test",
  fetchImpl: fetchImpl as unknown as typeof fetch,
});

describe("createBeeClient", () => {
  it("sends the bearer token and passes limit and cursor", async () => {
    const f = fakeFetch(200, { conversations: [], next_cursor: null, timezone: "America/Chicago" });
    await createBeeClient(opts(f)).listConversations({ limit: 5, cursor: "v1-123" });
    const [url, init] = f.mock.calls[0]!;
    expect(String(url)).toBe("https://bee.test/v1/conversations?limit=5&cursor=v1-123");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer tok");
  });

  it("omits undefined query params", async () => {
    const f = fakeFetch(200, { journals: [], next_cursor: null });
    await createBeeClient(opts(f)).listJournals({});
    expect(String(f.mock.calls[0]![0])).toBe("https://bee.test/v1/journals");
  });

  it("throws BeeApiError with status and path on a 500", async () => {
    const f = fakeFetch(500, "boom");
    const err = await createBeeClient(opts(f)).listTodos({ limit: 3 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BeeApiError);
    expect((err as BeeApiError).status).toBe(500);
    expect((err as BeeApiError).path).toBe("/v1/todos?limit=3");
  });

  it("parses a conversation and tolerates extra fields", async () => {
    const f = fakeFetch(200, {
      conversation: {
        id: 42, start_time: 1760600000000, end_time: null, state: "COMPLETED", summary: "Lunch",
        short_summary: null, device_type: "bee", unknown_field: true,
        transcriptions: [{ id: 1, realtime: false, utterances: [
          { id: 9, text: "You have to try it", speaker: "Unknown", spoken_at: 1760600001000, start: null, end: null, created_at: 1 },
        ] }],
        primary_location: null,
      },
      timezone: "America/Chicago",
    });
    const { conversation } = await createBeeClient(opts(f)).getConversation(42);
    expect(conversation.id).toBe(42);
    expect(conversation.transcriptions[0]!.utterances[0]!.text).toBe("You have to try it");
  });

  it("normalizes numeric journal ids to strings", async () => {
    const f = fakeFetch(200, { journals: [{ id: 55, text: "hi", state: "READY", created_at: 1, updated_at: 2 }], next_cursor: null });
    const { journals } = await createBeeClient(opts(f)).listJournals({ limit: 1 });
    expect(journals[0]!.id).toBe("55");
  });
});

describe("toDate", () => {
  it("handles epoch ms, ISO strings and null", () => {
    expect(toDate(0)?.toISOString()).toBe("1970-01-01T00:00:00.000Z");
    expect(toDate("2026-10-16T10:00:00Z")?.toISOString()).toBe("2026-10-16T10:00:00.000Z");
    expect(toDate(null)).toBeNull();
    expect(toDate("not a date")).toBeNull();
  });
});

describe("facts", () => {
  it("getFact unwraps either response shape", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ fact: { id: 3, text: "Loves jazz", confirmed: true }, timezone: "America/Chicago" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 4, text: "Loves ramen", confirmed: false, tags: [] })));
    const bee = createBeeClient({ token: "t", baseUrl: "https://bee.test", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await bee.getFact(3)).toEqual({ id: 3, text: "Loves jazz", confirmed: true });
    expect(await bee.getFact(4)).toEqual({ id: 4, text: "Loves ramen", confirmed: false });
    expect(fetchImpl.mock.calls[0][0]).toBe("https://bee.test/v1/facts/3");
  });

  it("createFact needs only an id, wrapped or bare", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ fact: { id: 5, surprise: 1 }, timezone: "x" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 6 })));
    const bee = createBeeClient({ token: "t", baseUrl: "https://bee.test", fetchImpl: f as unknown as typeof fetch });
    expect((await bee.createFact("a")).id).toBe(5);
    expect((await bee.createFact("b")).id).toBe(6);
  });

  it("createFact POSTs only the text", async () => {
    const f = fakeFetch(200, { id: 9, text: "Loves jazz", confirmed: false });
    expect(await createBeeClient(opts(f)).createFact("Loves jazz")).toEqual({ id: 9, text: "Loves jazz", confirmed: false });
    const [url, init] = f.mock.calls[0]!;
    expect(String(url)).toBe("https://bee.test/v1/facts");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ text: "Loves jazz" });
  });
});

// pnpm forget (M3-T11, adapted from PostHog draft PR #8): DELETE /v1/todos/:id and /v1/facts/:id (bee-api.md).
describe("Bee deletes", () => {
  it("deleteTodo and deleteFact send DELETE, accept an empty body, and surface a 404 status", async () => {
    const f = fakeFetch(200, "");
    const bee = createBeeClient(opts(f));
    await bee.deleteTodo(10);
    await bee.deleteFact(5);
    expect(f.mock.calls.map(([url, init]) => [String(url), init?.method])).toEqual([
      ["https://bee.test/v1/todos/10", "DELETE"], ["https://bee.test/v1/facts/5", "DELETE"],
    ]);
    const err = await createBeeClient(opts(fakeFetch(404, "not found"))).deleteTodo(10).catch((e) => e);
    expect(err).toBeInstanceOf(BeeApiError);
    expect(err.status).toBe(404);
  });
});

describe("getTodo (M5-T6)", () => {
  it("GETs one todo and surfaces a 404 as BeeApiError", async () => {
    const f = fakeFetch(200, JSON.stringify({ id: 9, text: "x", completed: true }));
    expect(await createBeeClient(opts(f)).getTodo(9)).toMatchObject({ id: 9, completed: true });
    expect(String(f.mock.calls[0][0])).toBe("https://bee.test/v1/todos/9");
    const err = await createBeeClient(opts(fakeFetch(404, "not found"))).getTodo(9).catch((e) => e);
    expect(err).toBeInstanceOf(BeeApiError);
    expect(err.status).toBe(404);
  });
});
