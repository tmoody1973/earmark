import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeMockDb } from "../../helpers/mock-db";

const h = vi.hoisted(() => ({ mock: undefined as unknown as ReturnType<typeof import("../../helpers/mock-db").makeMockDb> }));
vi.mock("../../../agent/lib/db", () => ({ db: () => h.mock.sql }));

import { mergeClusters, undoMerge } from "../../../agent/lib/garden/merge";

// The SQL itself is proven against the Neon test branch (tests/integration/links.int.test.ts); these pin the guards.
describe("mergeClusters", () => {
  beforeEach(() => { h.mock = makeMockDb(); });
  afterEach(() => { delete process.env.GARDEN_READ_ONLY; });

  it("refuses to merge an idea into itself, before any query", async () => {
    await expect(mergeClusters(3, 3)).rejects.toThrow(/itself/);
    expect(h.mock.calls).toHaveLength(0);
  });

  it("is a no-op on a read-only e2e run", async () => {
    process.env.GARDEN_READ_ONLY = "1";
    expect(await mergeClusters(1, 2)).toBeNull();
    expect(h.mock.calls).toHaveLength(0);
  });

  it("runs as one transaction keyed by a fresh token, records the merge first, and returns its id", async () => {
    h.mock.queue.push([{ id: 41 }]);
    expect(await mergeClusters(1, 2)).toBe(41);
    expect(h.mock.sql.transaction).toHaveBeenCalledTimes(1);
    expect(h.mock.calls[0].text).toContain("insert into idea_merges");
    // both ideas must still be growing (never merge into or from a dismissed or already-merged idea)
    expect(h.mock.calls[0].text).toMatch(/stage <> 'dismissed'/);
    const token = h.mock.calls[0].values.find((v) => typeof v === "string" && /^[0-9a-f-]{36}$/.test(v));
    expect(token).toBeTruthy();
    // every later statement acts only through that merge row, so a refused merge changes nothing
    for (const c of h.mock.calls.slice(1)) expect(c.values).toContain(token);
  });

  it("returns null when the guards refused (an idea was already dismissed or merged)", async () => {
    h.mock.queue.push([]);
    expect(await mergeClusters(1, 2)).toBeNull();
  });
});

describe("undoMerge", () => {
  beforeEach(() => { h.mock = makeMockDb(); });
  afterEach(() => { delete process.env.GARDEN_READ_ONLY; });

  it("is a no-op on a read-only e2e run", async () => {
    process.env.GARDEN_READ_ONLY = "1";
    expect(await undoMerge(5)).toBe(false);
    expect(h.mock.calls).toHaveLength(0);
  });

  it("claims the merge row first (undone_at is null), then every statement acts only if that claim happened in this transaction", async () => {
    h.mock.queue.push([{ id: 5 }]);
    expect(await undoMerge(5)).toBe(true);
    expect(h.mock.sql.transaction).toHaveBeenCalledTimes(1);
    expect(h.mock.calls[0].text).toMatch(/update idea_merges mg set undone_at = now\(\)[\s\S]*undone_at is null[\s\S]*stage <> 'dismissed'/);
    for (const c of h.mock.calls.slice(1)) expect(c.text).toMatch(/undone_at = now\(\)/);
  });

  it("reports false when the merge was already undone", async () => {
    h.mock.queue.push([]);
    expect(await undoMerge(5)).toBe(false);
  });
});
