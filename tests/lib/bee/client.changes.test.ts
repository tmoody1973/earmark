import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { BeeChangesSchema, createBeeClient } from "../../../agent/lib/bee/client";

// Real shape (observed 2026-10-16): the meta fields sit at the TOP level, not under a `meta` key; ids are bare numbers.
const meta = { next_cursor: "v1-1760610000000", since: 1760600000000, until: 1760610000000, updated: true, timezone: "America/Chicago" };
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const empty = { facts: [], todos: [], dailies: [], conversations: [], journals: [] };

describe("BeeClient.changes", () => {
  it("bootstraps without a cursor", async () => {
    const fetchImpl = vi.fn(async () => ok({ ...meta, ...empty }));
    const bee = createBeeClient({ token: "tok", baseUrl: "https://bee.test", fetchImpl: fetchImpl as never });
    const r = await bee.changes();
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe("https://bee.test/v1/changes");
    expect(r.next_cursor).toBe("v1-1760610000000");
  });

  it("passes the cursor and accepts bare ids or objects with an id", async () => {
    const fetchImpl = vi.fn(async () => ok({ ...meta, ...empty, facts: [7], todos: [{ id: 10, text: "x" }], conversations: [{ id: 123 }], journals: ["55"] }));
    const bee = createBeeClient({ token: "tok", baseUrl: "https://bee.test", fetchImpl: fetchImpl as never });
    const r = await bee.changes("v1-1760600000000");
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe("https://bee.test/v1/changes?cursor=v1-1760600000000");
    expect(r.conversations).toEqual([{ id: 123 }]);
    expect(r.journals).toEqual(["55"]);
  });

  it("treats a missing list as empty and rejects a body without next_cursor", () => {
    expect(BeeChangesSchema.parse(meta).journals).toEqual([]);
    expect(() => BeeChangesSchema.parse({ ...empty })).toThrow();
  });

  it("parses the real (redacted) fixture", () => {
    const fixture = JSON.parse(readFileSync("tests/fixtures/bee-changes.json", "utf8"));
    const r = BeeChangesSchema.parse(fixture);
    expect(r.conversations).toEqual([11331219]);
  });
});
