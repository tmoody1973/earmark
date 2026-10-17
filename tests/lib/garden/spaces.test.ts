import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeMockDb } from "../../helpers/mock-db";

const h = vi.hoisted(() => ({ mock: undefined as unknown as ReturnType<typeof import("../../helpers/mock-db").makeMockDb> }));
vi.mock("../../../agent/lib/db", () => ({ db: () => h.mock.sql }));

import {
  createSpace, deleteSpace, getSpace, listSpaces, renameSpace, setSpaceItemStatus, spaceCounts,
} from "../../../agent/lib/garden/spaces";
import { HIDDEN_TIP_STATUSES } from "../../../agent/lib/garden/queries";
import { SPACE_MIN } from "../../../agent/lib/spaces/criteria";

const spaceRow = (over: Record<string, unknown> = {}) => ({
  id: "3", name: "Books to give my dad", rule_sentence: "Books to give my dad", created_at: "2026-10-16T10:00:00Z",
  members: 4, pending: 12, ...over,
});

beforeEach(() => {
  h.mock = makeMockDb();
  delete process.env.GARDEN_READ_ONLY;
});
afterEach(() => {
  delete process.env.GARDEN_READ_ONLY;
});

describe("listSpaces", () => {
  it("lists each Space with its members and how many items it is still sorting", async () => {
    h.mock.queue.push([spaceRow(), spaceRow({ id: "1", name: "Dad", members: 0, pending: 0 })]);
    expect(await listSpaces()).toEqual([
      { id: 3, name: "Books to give my dad", sentence: "Books to give my dad", members: 4, pending: 12, createdAt: "2026-10-16T10:00:00.000Z" },
      { id: 1, name: "Dad", sentence: "Books to give my dad", members: 0, pending: 0, createdAt: "2026-10-16T10:00:00.000Z" },
    ]);
    const q = h.mock.calls[0];
    // members: kept, or suggested at or above the floor; only items the garden itself shows count
    expect(q.text).toMatch(/si\.status = 'accepted' or \(si\.status = 'suggested' and si\.confidence >= /);
    expect(q.values).toContain(SPACE_MIN);
    expect(q.values).toContainEqual(HIDDEN_TIP_STATUSES);
    expect(q.text).toMatch(/stage <> 'dismissed' and c\.mention_count > 0/);
    // still to sort: never judged, or a call that failed and waits for its retry
    expect(q.text).toMatch(/si\.space_id is null or si\.confidence is null/);
  });
});

describe("spaceCounts", () => {
  it("says what is in a Space and what is still being sorted, in real counts", () => {
    expect(spaceCounts({ members: 4, pending: 12 })).toBe("4 items · still sorting 12");
    expect(spaceCounts({ members: 1, pending: 0 })).toBe("1 item");
    expect(spaceCounts({ members: 0, pending: 3 })).toBe("Still sorting 3");
    expect(spaceCounts({ members: 0, pending: 0 })).toBe("Nothing yet");
  });
});

describe("getSpace", () => {
  it("is not sorting now when nothing is left to sort (no extra query)", async () => {
    h.mock.queue.push([spaceRow({ pending: 0 })], [], []);
    expect((await getSpace(3))!.sortingNow).toBe(false);
    expect(h.mock.calls.some((c) => c.text.includes("sync_cursors"))).toBe(false);
  });

  it("is null for a Space that does not exist", async () => {
    h.mock.queue.push([]);
    expect(await getSpace(99)).toBeNull();
    expect(h.mock.calls).toHaveLength(1);
  });

  it("returns the members, Tarik's keeps first, from visible items only, with the shelf's columns", async () => {
    h.mock.queue.push(
      [spaceRow()],
      [{ sorting: true }],
      [{ member_status: "accepted", id: 4, title: "A weekly record store visit", stage: "sprouting", mention_count: 2,
        last_mentioned_at: "2026-10-15T00:00:00Z", pinned: false, flagged: false, confirmed: true, timeline: [], dismissed_at: [] }],
      [{ member_status: "suggested", id: 9, type: "book", canonical_name: "Sample Novel", creator: "A. Writer", year_or_address: null,
        image_url: null, context_summary: null, said_at: "2026-10-14T00:00:00Z", created_at: "2026-10-14T00:00:00Z", status: "new",
        rating: null, lat: null, lng: null, links: null, recommender_id: null, first_name: null }],
    );
    const view = await getSpace(3);
    expect(view!.space.id).toBe(3);
    expect(view!.ideas).toEqual([expect.objectContaining({ status: "accepted", plant: expect.objectContaining({ id: 4, title: "A weekly record store visit" }) })]);
    expect(view!.tips).toEqual([expect.objectContaining({ status: "suggested", rec: expect.objectContaining({ id: 9, name: "Sample Novel" }) })]);
    // sorting now: a pass holds the lock, or the Space is new enough that its first fill is about to start
    expect(view!.sortingNow).toBe(true);
    const [, sorting, ideas, tips] = h.mock.calls;
    expect(sorting.text).toMatch(/from sync_cursors where name = \? and updated_at > now\(\) - interval '15 minutes'/);
    expect(sorting.values).toContain("spaces_evaluate_lock");
    expect(sorting.text).toMatch(/created_at > now\(\) - interval '30 seconds'/);
    for (const q of [ideas, tips]) {
      expect(q.text).toMatch(/si\.status = 'accepted' or \(si\.status = 'suggested' and si\.confidence >= /);
      expect(q.text).toMatch(/order by si\.status = 'accepted' desc/);
    }
    expect(ideas.text).toMatch(/c\.stage <> 'dismissed' and c\.mention_count > 0/);
    expect(tips.values).toContainEqual(HIDDEN_TIP_STATUSES);
    expect(tips.text).not.toMatch(/raw_text|excerpt/);
  });
});

describe("writes", () => {
  it("creates a Space named by its sentence", async () => {
    h.mock.queue.push([{ id: "12" }]);
    expect(await createSpace("Books to give my dad")).toBe(12);
    expect(h.mock.calls[0].text).toMatch(/insert into spaces \(name, rule_sentence\)/);
    expect(h.mock.calls[0].values).toEqual(["Books to give my dad", "Books to give my dad"]);
  });

  it("renames only when the name changes, and reports whether a row changed", async () => {
    h.mock.queue.push([{ id: 3 }]);
    expect(await renameSpace(3, "Dad’s books")).toBe(true);
    expect(h.mock.calls[0].text).toMatch(/update spaces set name = \? where id = \? and name <> \?/);
    expect(await renameSpace(3, "Dad’s books")).toBe(false); // no row back
  });

  it("deletes a Space (its judgements go with it; the items stay)", async () => {
    h.mock.queue.push([{ id: 3 }]);
    expect(await deleteSpace(3)).toBe(true);
    expect(h.mock.calls[0].text).toMatch(/delete from spaces where id = \? returning id/);
    expect(await deleteSpace(3)).toBe(false);
  });

  it("keep acts on a suggestion only; remove on anything not already removed", async () => {
    const key = { spaceId: 3, itemType: "rec" as const, itemId: 9 };
    h.mock.queue.push([{ space_id: 3 }]);
    expect(await setSpaceItemStatus(key, "accepted")).toBe(true);
    expect(h.mock.calls[0].text).toMatch(/update space_items set status = \?[\s\S]*and status = 'suggested'/);
    expect(h.mock.calls[0].values).toEqual(["accepted", 3, "rec", 9]);
    expect(await setSpaceItemStatus(key, "removed")).toBe(false);
    expect(h.mock.calls[1].text).toMatch(/and status <> 'removed'/);
  });

  it("writes nothing when the garden is read-only (a real-data e2e run)", async () => {
    process.env.GARDEN_READ_ONLY = "1";
    expect(await createSpace("Books to give my dad")).toBeNull();
    expect(await renameSpace(3, "x")).toBe(false);
    expect(await deleteSpace(3)).toBe(false);
    expect(await setSpaceItemStatus({ spaceId: 3, itemType: "idea", itemId: 4 }, "removed")).toBe(false);
    expect(h.mock.calls).toHaveLength(0);
  });
});
