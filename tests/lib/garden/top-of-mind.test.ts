import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeMockDb } from "../../helpers/mock-db";

const h = vi.hoisted(() => ({ mock: undefined as unknown as ReturnType<typeof import("../../helpers/mock-db").makeMockDb> }));
vi.mock("../../../agent/lib/db", () => ({ db: () => h.mock.sql }));

import { PIN_CAP, setPinned } from "../../../agent/lib/garden/top-of-mind";

const ON = { BEE_TODO_WRITES: "on" };
const cluster = { title: "Station crates", mention_count: 2, first_mentioned_at: "2026-10-15T15:00:00Z", bee_fact_id: null };
const texts = () => h.mock.calls.map((c) => c.text);

describe("setPinned (Top of Mind, FR-35)", () => {
  beforeEach(() => { h.mock = makeMockDb(); });

  it("pins at most PIN_CAP live ideas, never a dismissed one, and only one that is not pinned yet (idempotent)", async () => {
    h.mock.queue.push([cluster], []);
    expect(await setPinned(4, true, {})).toEqual({ changed: true });
    const pin = h.mock.calls[0]!;
    expect(pin.text).toContain("update idea_clusters set pinned = true");
    expect(pin.text).toContain("not pinned");
    expect(pin.text).toContain("stage <> 'dismissed'");
    expect(pin.text).toMatch(/count\(\*\) from idea_clusters where pinned and stage <> 'dismissed'\) < \?/);
    expect(pin.values).toEqual([4, PIN_CAP]);
    expect(PIN_CAP).toBe(5);
  });

  it("with the Bee kill switch off, a pin writes no fact proposal", async () => {
    h.mock.queue.push([cluster]);
    await setPinned(4, true, {});
    expect(texts().some((t) => t.includes("fact_proposals"))).toBe(false);
  });

  it("with the switch on, a pin queues one pending idea fact for the weekly writer (never a direct Bee call)", async () => {
    h.mock.queue.push([cluster], [{ first_name: "Ann" }], []);
    expect(await setPinned(4, true, ON)).toEqual({ changed: true });
    const insert = h.mock.calls.find((c) => c.text.includes("insert into fact_proposals"))!;
    expect(insert.text).toContain("'idea'");
    expect(insert.text).toContain("where not exists");
    expect(insert.values).toContain("Developing an idea: Station crates (mentioned 2 times since Oct)");
    expect(insert.values).toContain("[4]");
  });

  it("never proposes a fact whose title names a person, or for an idea already linked to a Bee fact", async () => {
    h.mock.queue.push([{ ...cluster, title: "Ann's ramen zine" }], [{ first_name: "Ann" }]);
    await setPinned(4, true, ON);
    h.mock.queue.push([{ ...cluster, bee_fact_id: 99 }]);
    await setPinned(5, true, ON);
    expect(texts().some((t) => t.includes("insert into fact_proposals"))).toBe(false);
  });

  it("at the cap: nothing changes and the owner is told why", async () => {
    h.mock.queue.push([], [{ pinned: false, stage: "sprouting" }]);
    const r = await setPinned(4, true, ON);
    expect(r.changed).toBe(false);
    expect(r.refused).toBe(`Top of Mind holds ${PIN_CAP} ideas. Unpin one to make room.`);
    expect(texts().some((t) => t.includes("fact_proposals"))).toBe(false);
  });

  it("pinning an idea that is already pinned is a quiet no-op", async () => {
    h.mock.queue.push([], [{ pinned: true, stage: "ready" }]);
    expect(await setPinned(4, true, ON)).toEqual({ changed: false });
  });

  it("unpinning drops the pin's fact only while it is unsent and unclaimed", async () => {
    h.mock.queue.push([{ id: 4 }], []);
    expect(await setPinned(4, false, ON)).toEqual({ changed: true });
    expect(h.mock.calls[0]!.text).toContain("set pinned = false");
    expect(h.mock.calls[0]!.text).toContain("and pinned");
    const del = h.mock.calls[1]!.text;
    expect(del).toContain("delete from fact_proposals");
    for (const guard of ["kind = 'idea'", "status = 'pending'", "bee_fact_id is null", "write_started_at is null"]) expect(del).toContain(guard);
  });

  it("unpinning an idea that is not pinned touches no proposal", async () => {
    h.mock.queue.push([]);
    expect(await setPinned(4, false, ON)).toEqual({ changed: false });
    expect(h.mock.calls).toHaveLength(1);
  });

  it("a read-only e2e run writes nothing", async () => {
    expect(await setPinned(4, true, { ...ON, GARDEN_READ_ONLY: "1" })).toEqual({ changed: false });
    expect(h.mock.calls).toHaveLength(0);
  });

  it.each([0, -1, 1.5, Number.NaN])("refuses the id %s", async (bad) => {
    await expect(setPinned(bad, true, ON)).rejects.toThrow(/invalid idea id/);
    expect(h.mock.calls).toHaveLength(0);
  });
});
