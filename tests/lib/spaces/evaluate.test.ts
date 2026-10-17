import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeMockDb } from "../../helpers/mock-db";

const h = vi.hoisted(() => ({ mock: undefined as unknown as ReturnType<typeof import("../../helpers/mock-db").makeMockDb> }));
vi.mock("../../../agent/lib/db", () => ({ db: () => h.mock.sql }));

import {
  evaluateSpaces, MAX_CALLS_PER_RUN, MAX_CALLS_PER_SPACE, MAX_SPACES_PER_CALL, spaceKey, spaceQuestion,
} from "../../../agent/lib/spaces/evaluate";
import { HIDDEN_TIP_STATUSES } from "../../../agent/lib/garden/queries";

// A pending item as the candidate query returns it: the item, and every space still waiting to judge it.
const rec = (id: number, spaces: number[]) => ({
  item_type: "rec", item_id: String(id), name: "Sample Novel", detail: "a sample reason to read it", timeline: null,
  rec_type: "book", creator: "A. Writer", space_ids: spaces.map(String), sentences: spaces.map((s) => `Sample space ${s}`),
});
const idea = (id: number, spaces: number[]) => ({
  item_type: "idea", item_id: String(id), name: "A weekly record store visit", detail: null,
  timeline: [{ date: "2026-10-07T00:00:00.000Z", line: "Oct 7: first heard" }],
  rec_type: null, creator: null, space_ids: spaces.map(String), sentences: spaces.map((s) => `Sample space ${s}`),
});
const CLAIMED = [{ name: "spaces_evaluate_lock" }];
const writes = () => h.mock.calls.filter((c) => c.text.includes("insert into space_items"));

beforeEach(() => {
  h.mock = makeMockDb();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the Space question (Jev reads it literally)", () => {
  it("keys each space with a non-numeric prefix and quotes the sentence as written", () => {
    expect(spaceKey(12)).toBe("s_12");
    expect(spaceQuestion("Books to give my dad").instructions)
      .toBe('Does the item in `item` belong in the collection described as: "Books to give my dad"?');
  });

  it("states both sides with a synthetic boundary case", () => {
    const q = spaceQuestion("anything");
    expect(q.whenTrue).toMatch(/Example: .*places to eat in Milwaukee.*ramen restaurant in Milwaukee/);
    expect(q.whenFalse).toMatch(/Milwaukee record store/);
  });
});

describe("evaluateSpaces", () => {
  it("asks once per item about every space still waiting on it, and stores each probability", async () => {
    h.mock.queue.push(CLAIMED, [rec(9, [1, 2]), idea(4, [1])]);
    const ask = vi.fn()
      .mockResolvedValueOnce({ s_1: 0.91, s_2: 0.05 })
      .mockResolvedValueOnce({ s_1: 0.2 });
    const out = await evaluateSpaces({ ask: ask as never });
    expect(out).toMatchObject({ calls: 2, pairs: 3, failed: 0, busy: false });
    expect(ask.mock.calls[0][0]).toEqual({ item: "book: Sample Novel by A. Writer. a sample reason to read it" });
    expect(Object.keys(ask.mock.calls[0][1])).toEqual(["s_1", "s_2"]);
    expect(ask.mock.calls[0][1].s_2.instructions).toContain('"Sample space 2"');
    expect(ask.mock.calls[1][0]).toEqual({ item: "idea: A weekly record store visit. Notes: first heard" });
    expect(writes().map((c) => c.values)).toEqual([
      ["rec", 9, [1, 2], [0.91, 0.05], "rec", 9, "rec", 9],
      ["idea", 4, [1], [0.2], "idea", 4, "idea", 4],
    ]);
  });

  it("re-judges only a suggestion whose item changed since, never Tarik's keep or remove, and never a hidden item", async () => {
    h.mock.queue.push(CLAIMED, []);
    await evaluateSpaces({ ask: vi.fn() as never });
    const q = h.mock.calls[1];
    expect(q.text).toMatch(/si\.space_id is null or \(si\.status = 'suggested' and si\.judged_at < v\.updated_at\)/);
    expect(q.text).toMatch(/stage <> 'dismissed' and c\.mention_count > 0/);
    expect(q.values).toContainEqual(HIDDEN_TIP_STATUSES);
    // the write refreshes a suggestion only, skips a space deleted meanwhile and an item forgotten meanwhile
    h.mock = makeMockDb();
    h.mock.queue.push(CLAIMED, [rec(9, [1])]);
    await evaluateSpaces({ ask: vi.fn(async () => ({ s_1: 0.8 })) as never });
    const w = writes()[0].text;
    expect(w).toMatch(/join spaces s on s\.id = t\.space_id/);
    expect(w).toMatch(/exists \(select 1 from recommendations where id = /);
    expect(w).toMatch(/on conflict \(space_id, item_type, item_id\) do update[\s\S]*where space_items\.status = 'suggested'/);
  });

  it("splits an item waiting on many spaces into calls of at most MAX_SPACES_PER_CALL questions", async () => {
    const many = Array.from({ length: MAX_SPACES_PER_CALL + 2 }, (_, i) => i + 1);
    h.mock.queue.push(CLAIMED, [rec(9, many)]);
    const ask = vi.fn(async (_s: unknown, qs: Record<string, unknown>) => Object.fromEntries(Object.keys(qs).map((k) => [k, 0.1])));
    const out = await evaluateSpaces({ ask: ask as never });
    expect(ask.mock.calls.map((c) => Object.keys(c[1]).length)).toEqual([MAX_SPACES_PER_CALL, 2]);
    expect(out).toMatchObject({ calls: 2, pairs: MAX_SPACES_PER_CALL + 2 });
  });

  it("stops at the per-run cap, and never fetches more items than it can judge", async () => {
    h.mock.queue.push(CLAIMED, Array.from({ length: MAX_CALLS_PER_RUN + 5 }, (_, i) => rec(i + 1, [1, 2])));
    // two spaces, so the per-space cap (lower than the run cap) is not what stops it
    const ask = vi.fn(async () => ({ s_1: 0.1, s_2: 0.1 }));
    const out = await evaluateSpaces({ ask: ask as never, maxCalls: 3 });
    expect(ask).toHaveBeenCalledTimes(3);
    expect(out.calls).toBe(3);
    expect(h.mock.calls[1].values).toContain(3); // the candidate limit
  });

  it("gives any one space at most MAX_CALLS_PER_SPACE calls a run, so one new space cannot starve the rest", async () => {
    const items = Array.from({ length: MAX_CALLS_PER_SPACE + 4 }, (_, i) => rec(i + 1, i < MAX_CALLS_PER_SPACE + 2 ? [1] : [1, 2]));
    h.mock.queue.push(CLAIMED, items);
    const ask = vi.fn(async (_s: unknown, qs: Record<string, unknown>) => Object.fromEntries(Object.keys(qs).map((k) => [k, 0.1])));
    const out = await evaluateSpaces({ ask: ask as never });
    const asked = ask.mock.calls.flatMap((c) => Object.keys(c[1]));
    expect(asked.filter((k) => k === "s_1")).toHaveLength(MAX_CALLS_PER_SPACE);
    expect(asked.filter((k) => k === "s_2")).toHaveLength(2); // space 2 still gets its turn
    expect(out.skipped).toBe(4); // pairs left for the next run
  });

  it("logs ids and the error name only, and stops after three failures in a row (the gateway is down)", async () => {
    h.mock.queue.push(CLAIMED, [rec(1, [1]), rec(2, [1]), rec(3, [1]), rec(4, [1])]);
    const boom = Object.assign(new Error("Sample Novel by A. Writer"), { name: "TimeoutError" });
    const ask = vi.fn(async () => { throw boom; });
    const out = await evaluateSpaces({ ask: ask as never });
    expect(ask).toHaveBeenCalledTimes(3);
    expect(out).toMatchObject({ failed: 3, pairs: 0 });
    expect(writes()).toHaveLength(0);
    const logged = [...vi.mocked(console.error).mock.calls, ...vi.mocked(console.log).mock.calls].flat().join(" ");
    expect(logged).toContain("TimeoutError");
    expect(logged).toContain("rec=1");
    expect(logged).not.toMatch(/Sample Novel|A\. Writer|Sample space/);
  });

  it("scopes to one space when asked (the fill right after a space is created)", async () => {
    h.mock.queue.push(CLAIMED, []);
    await evaluateSpaces({ spaceId: 7, ask: vi.fn() as never });
    expect(h.mock.calls[1].values).toContain(7);
  });

  it("does nothing while another run holds the lock, and releases its own lock", async () => {
    const ask = vi.fn();
    expect(await evaluateSpaces({ ask: ask as never })).toMatchObject({ busy: true, calls: 0 });
    expect(h.mock.calls).toHaveLength(1);
    expect(h.mock.calls[0].text).toMatch(/insert into sync_cursors[\s\S]*updated_at < now\(\) - interval '15 minutes'/);

    h.mock = makeMockDb();
    h.mock.queue.push(CLAIMED, []);
    await evaluateSpaces({ ask: ask as never });
    expect(h.mock.calls.at(-1)!.text).toMatch(/delete from sync_cursors where name = \? and cursor = \?/);
  });
});
