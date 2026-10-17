import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeMockDb } from "../../helpers/mock-db";

const h = vi.hoisted(() => ({ mock: undefined as unknown as ReturnType<typeof import("../../helpers/mock-db").makeMockDb> }));
vi.mock("../../../agent/lib/db", () => ({ db: () => h.mock.sql }));

import { HIDDEN_TIP_STATUSES } from "../../../agent/lib/garden/queries";
import {
  FORGETTABLE_TIP_STATUSES, STALLED_IDEA_STAGES, compostItem, getSerendipity, heardNote, isForgotten, keepItem,
  pickSerendipity, undoCompost, type SerendipityCandidate,
} from "../../../agent/lib/garden/serendipity";

const now = new Date("2026-10-21T12:00:00Z");
const days = (n: number) => new Date(now.getTime() - n * 86_400_000);

const rec = (id: number, lastTouched: Date, surfaced: Date | null = null): SerendipityCandidate =>
  ({ type: "rec", id, title: `rec ${id}`, lastTouchedAt: lastTouched, lastSurfacedAt: surfaced });
const idea = (id: number, lastTouched: Date, surfaced: Date | null = null): SerendipityCandidate =>
  ({ type: "idea", id, title: `idea ${id}`, lastTouchedAt: lastTouched, lastSurfacedAt: surfaced });

describe("serendipity: what counts as forgotten", () => {
  it("a tip is forgotten after 3 days, an idea stalls after 4", () => {
    expect(isForgotten(rec(1, days(3.1)), now)).toBe(true);
    expect(isForgotten(rec(1, days(2)), now)).toBe(false);
    expect(isForgotten(idea(1, days(3.5)), now)).toBe(false);
    expect(isForgotten(idea(1, days(4.1)), now)).toBe(true);
  });

  it("respects the 1-day cooldown after surfacing", () => {
    expect(isForgotten(rec(1, days(10), days(0.5)), now)).toBe(false);
    expect(isForgotten(rec(1, days(10), days(1.5)), now)).toBe(true);
  });

  it("picks the most forgotten item, by last surfaced or touched, and null when none qualify", () => {
    const picked = pickSerendipity([rec(1, days(5)), idea(2, days(9)), rec(3, days(20), days(2))], now);
    expect(picked).toMatchObject({ type: "idea", id: 2 });
    expect(pickSerendipity([rec(1, days(1))], now)).toBeNull();
    expect(pickSerendipity([], now)).toBeNull();
  });

  it("only offers tips still on the shelf and not yet tried, and ideas still growing", () => {
    expect(FORGETTABLE_TIP_STATUSES.some((s) => HIDDEN_TIP_STATUSES.includes(s))).toBe(false);
    expect([...FORGETTABLE_TIP_STATUSES].sort()).toEqual(["new", "queued"]);
    expect([...STALLED_IDEA_STAGES].sort()).toEqual(["compost", "sprouting"]); // never ready, drafted, used or dismissed
  });

  it("says how long ago it was heard, in whole days", () => {
    expect(heardNote(days(1.2), now)).toBe("Heard 1 day ago");
    expect(heardNote(days(6.9), now)).toBe("Heard 6 days ago");
  });
});

describe("serendipity: reading the pick", () => {
  beforeEach(() => { h.mock = makeMockDb(); });

  const recRow = {
    id: 7, type: "album", canonical_name: "Promises", creator: "Floating Points", year_or_address: "2021", image_url: null,
    context_summary: "For the long drive.", said_at: days(9).toISOString(), created_at: days(9).toISOString(), status: "queued",
    rating: null, lat: null, lng: null, links: null, recommender_id: 4, first_name: "Ann",
    last_touched_at: days(9).toISOString(), last_surfaced_at: null,
  };
  const ideaRow = {
    id: 3, title: "A show about record stores", stage: "sprouting", mention_count: 2, last_mentioned_at: days(5).toISOString(),
    pinned: false, flagged: false, confirmed: true, timeline: [], dismissed_at: [],
    last_touched_at: days(5).toISOString(), last_surfaced_at: null,
  };

  it("reads forgettable tips and stalled, unpinned ideas, and returns the most forgotten with its card", async () => {
    h.mock.queue.push([recRow], [ideaRow]);
    const pick = await getSerendipity(now);
    expect(pick).toMatchObject({ type: "rec", id: 7, title: "Promises", note: "Heard 9 days ago" });
    expect(pick?.type === "rec" && pick.rec.recommender).toEqual({ id: 4, firstName: "Ann" });
    const [tips, ideas] = h.mock.calls;
    expect(tips.values).toContainEqual(FORGETTABLE_TIP_STATUSES);
    expect(tips.text).not.toContain("raw_text"); // the shelf's columns only
    expect(ideas.values).toContainEqual(STALLED_IDEA_STAGES);
    expect(ideas.text).toContain("not c.pinned");
    expect(ideas.text).toContain("c.mention_count > 0");
  });

  it("skips what the page already shows, so nothing appears twice", async () => {
    h.mock.queue.push([recRow], [ideaRow]);
    expect(await getSerendipity(now, [{ type: "rec", id: 7 }])).toMatchObject({ type: "idea", id: 3 });
    h.mock.queue.push([recRow], [ideaRow]);
    expect(await getSerendipity(now, [{ type: "rec", id: 7 }, { type: "idea", id: 3 }])).toBeNull();
    h.mock.queue.push([recRow], [ideaRow]);
    expect(await getSerendipity(now, [{ type: "idea", id: 7 }])).toMatchObject({ type: "rec", id: 7 }); // type matters
  });

  it("returns an idea with its plant, and null when nothing is forgotten", async () => {
    h.mock.queue.push([], [ideaRow]);
    expect(await getSerendipity(now)).toMatchObject({ type: "idea", id: 3, plant: { stage: "sprouting", mentionCount: 2 } });
    h.mock.queue.push([{ ...recRow, last_touched_at: days(1).toISOString() }], []);
    expect(await getSerendipity(now)).toBeNull();
  });
});

describe("serendipity: keep, compost and undo", () => {
  beforeEach(() => { h.mock = makeMockDb(); });
  afterEach(() => { delete process.env.GARDEN_READ_ONLY; });

  it("keep stamps last_surfaced_at, only while the item is still offered", async () => {
    h.mock.queue.push([{ id: 7 }]);
    expect(await keepItem({ type: "rec", id: 7 })).toBe(true);
    expect(h.mock.calls[0].text).toContain("update recommendations set last_surfaced_at = now()");
    expect(h.mock.calls[0].values).toContainEqual(FORGETTABLE_TIP_STATUSES);
    expect(await keepItem({ type: "idea", id: 3 })).toBe(false); // nothing returned: it had moved on
    expect(h.mock.calls[1].text).toContain("update idea_clusters set last_surfaced_at = now()");
    expect(h.mock.calls[1].values).toContainEqual(STALLED_IDEA_STAGES);
  });

  it("composting a tip goes through the status core (so its Bee todo is cleared), then stamps it", async () => {
    h.mock.queue.push([{ previous: "queued", recommender_id: 4 }]);
    const deferred: Array<() => Promise<void>> = [];
    const r = await compostItem({ type: "rec", id: 7 }, { defer: (fn) => deferred.push(fn) });
    expect(r).toEqual({ changed: true, previous: "queued" });
    const status = h.mock.calls[0];
    expect(status.text).toContain("update recommendations r set status =");
    expect(status.values).toContain("composted");
    expect(status.values).toContainEqual(["new", "queued"]); // WHERE-guarded: only a tip still offered
    expect(deferred).toHaveLength(1); // the status effects (Bee todos) run after the response
    expect(h.mock.calls.some((c) => c.text.includes("last_surfaced_at = now()"))).toBe(true);
  });

  it("composting a tip that already moved changes nothing", async () => {
    h.mock.queue.push([]);
    expect(await compostItem({ type: "rec", id: 7 })).toEqual({ changed: false, previous: null });
    expect(h.mock.calls).toHaveLength(1);
  });

  it("composting an idea dismisses it, only from compost or sprouting (never drafted or used)", async () => {
    h.mock.queue.push([{ previous: "sprouting" }]);
    expect(await compostItem({ type: "idea", id: 3 })).toEqual({ changed: true, previous: "sprouting" });
    const q = h.mock.calls[0];
    expect(q.text).toContain("stage = 'dismissed'");
    expect(q.text).toContain("for update");
    expect(q.values).toContainEqual(STALLED_IDEA_STAGES);
  });

  it("undo puts a tip back to the status it had, only while it is still composted", async () => {
    h.mock.queue.push([{ previous: "composted", recommender_id: null }]);
    expect(await undoCompost({ type: "rec", id: 7, previous: "queued" })).toBe(true);
    expect(h.mock.calls[0].values).toContain("queued");
    expect(h.mock.calls[0].values).toContainEqual(["composted"]);
    await expect(undoCompost({ type: "rec", id: 7, previous: "tried" as "queued" })).rejects.toThrow("invalid");
  });

  it("undo regrows an idea by the stage rule, only one Serendipity dismissed in the last hour", async () => {
    h.mock.queue.push([{ id: 3 }]);
    expect(await undoCompost({ type: "idea", id: 3 })).toBe(true);
    const q = h.mock.calls[0].text;
    expect(q).toContain("idea_stage_for('compost', mention_count)");
    expect(q).toContain("stage = 'dismissed'");
    expect(q).toContain("last_surfaced_at > now() - interval '1 hour'");
  });

  it("rejects a bad id before any query", async () => {
    await expect(compostItem({ type: "idea", id: -1 })).rejects.toThrow("invalid");
    await expect(keepItem({ type: "rec", id: 1.5 })).rejects.toThrow("invalid");
    expect(h.mock.calls).toHaveLength(0);
  });

  it("GARDEN_READ_ONLY: keep, compost and undo write nothing", async () => {
    process.env.GARDEN_READ_ONLY = "1";
    expect(await keepItem({ type: "rec", id: 7 })).toBe(false);
    expect(await compostItem({ type: "rec", id: 7 })).toEqual({ changed: false, previous: null });
    expect(await undoCompost({ type: "idea", id: 3 })).toBe(false);
    expect(h.mock.calls).toHaveLength(0);
  });
});
