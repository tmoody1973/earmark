import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeMockDb } from "../../helpers/mock-db";

const h = vi.hoisted(() => ({ mock: undefined as unknown as ReturnType<typeof import("../../helpers/mock-db").makeMockDb> }));
vi.mock("../../../agent/lib/db", () => ({ db: () => h.mock.sql }));

import { HIDDEN_TIP_STATUSES } from "../../../agent/lib/garden/queries";
import {
  FORGETTABLE_TIP_STATUSES, IDEA_REST_DAYS, STALLED_IDEA_STAGES, compostTip, getSerendipity, heardNote, isForgotten,
  keepItem, pickSerendipity, restIdea, undoCompostTip, type SerendipityCandidate,
} from "../../../agent/lib/garden/serendipity";

const now = new Date("2026-10-21T12:00:00Z");
const days = (n: number) => new Date(now.getTime() - n * 86_400_000);

const rec = (id: number, lastTouched: Date, surfaced: Date | null = null): SerendipityCandidate =>
  ({ type: "rec", id, title: `rec ${id}`, lastTouchedAt: lastTouched, lastSurfacedAt: surfaced });
const idea = (id: number, lastTouched: Date, surfaced: Date | null = null, strong = true): SerendipityCandidate =>
  ({ type: "idea", id, title: `idea ${id}`, lastTouchedAt: lastTouched, lastSurfacedAt: surfaced, strong });

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

  it("ranks confirmed or multi-mention ideas (and tips) ahead of weak ideas, which still come up when alone", () => {
    const weak = idea(1, days(30), null, false);
    expect(pickSerendipity([weak, idea(2, days(5))], now)).toMatchObject({ id: 2 });
    expect(pickSerendipity([weak, rec(3, days(4))], now)).toMatchObject({ type: "rec", id: 3 });
    expect(pickSerendipity([weak, idea(4, days(9), null, false)], now)).toMatchObject({ id: 1 }); // then the most forgotten
    expect(pickSerendipity([weak], now)).toMatchObject({ id: 1 }); // a preference, not a filter
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
    expect(ideas.text).toContain("(c.resting_until is null or c.resting_until <= now())"); // a resting idea waits
  });

  it("an idea is strong when confirmed or mentioned twice", async () => {
    const weak = { ...ideaRow, id: 8, mention_count: 1, confirmed: false, last_touched_at: days(40).toISOString() };
    h.mock.queue.push([], [weak, ideaRow]);
    expect(await getSerendipity(now)).toMatchObject({ type: "idea", id: 3 });
    h.mock.queue.push([], [weak, { ...ideaRow, mention_count: 1, confirmed: true }]);
    expect(await getSerendipity(now)).toMatchObject({ type: "idea", id: 3 });
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

describe("serendipity: keep, rest, compost and undo", () => {
  beforeEach(() => { h.mock = makeMockDb(); });
  afterEach(() => { delete process.env.GARDEN_READ_ONLY; });

  it("keep stamps last_surfaced_at, only while the item is still offered (never a pinned idea)", async () => {
    h.mock.queue.push([{ id: 7 }]);
    expect(await keepItem({ type: "rec", id: 7 })).toBe(true);
    expect(h.mock.calls[0].text).toContain("update recommendations set last_surfaced_at = now()");
    expect(h.mock.calls[0].values).toContainEqual(FORGETTABLE_TIP_STATUSES);
    expect(await keepItem({ type: "idea", id: 3 })).toBe(false); // nothing returned: it had moved on
    expect(h.mock.calls[1].text).toContain("update idea_clusters set last_surfaced_at = now()");
    expect(h.mock.calls[1].text).toContain("not pinned");
    expect(h.mock.calls[1].values).toContainEqual(STALLED_IDEA_STAGES);
  });

  it("Not now rests an idea for 60 days and never changes its stage", async () => {
    expect(IDEA_REST_DAYS).toBe(60);
    h.mock.queue.push([{ id: 3 }]);
    expect(await restIdea(3)).toBe(true);
    const q = h.mock.calls[0];
    expect(q.text).toContain("resting_until = now() + make_interval(days =>");
    expect(q.values).toContain(60);
    expect(q.text.split("where")[0]).not.toContain("stage"); // the SET leaves the stage alone: still growing on new mentions
    expect(q.text).toContain("not pinned");
    expect(q.values).toContainEqual(STALLED_IDEA_STAGES);
    expect(await restIdea(3)).toBe(false); // moved on (or pinned) meanwhile
  });

  it("composting a tip goes through the status core (so its Bee todo is cleared), then stamps it", async () => {
    h.mock.queue.push([{ previous: "queued", recommender_id: 4 }]);
    const deferred: Array<() => Promise<void>> = [];
    const r = await compostTip(7, { defer: (fn) => deferred.push(fn) });
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
    expect(await compostTip(7)).toEqual({ changed: false, previous: null });
    expect(h.mock.calls).toHaveLength(1);
  });

  it("undo puts a tip back, only one Serendipity composted within the hour", async () => {
    h.mock.queue.push([{ id: 7 }], [{ previous: "composted", recommender_id: null }]);
    expect(await undoCompostTip(7, "queued")).toBe(true);
    const window = h.mock.calls[0];
    expect(window.text).toContain("status = 'composted'");
    expect(window.text).toContain("last_surfaced_at > now() - interval '1 hour'");
    expect(h.mock.calls[1].values).toContain("queued");
    expect(h.mock.calls[1].values).toContainEqual(["composted"]);
  });

  it("undo outside the window (or of a tip composted elsewhere) changes nothing", async () => {
    h.mock.queue.push([]);
    expect(await undoCompostTip(7, "new")).toBe(false);
    expect(h.mock.calls).toHaveLength(1); // no status write
    await expect(undoCompostTip(7, "tried" as "new")).rejects.toThrow("invalid");
  });

  it("rejects a bad id before any query", async () => {
    await expect(restIdea(-1)).rejects.toThrow("invalid");
    await expect(compostTip(0)).rejects.toThrow("invalid");
    await expect(keepItem({ type: "rec", id: 1.5 })).rejects.toThrow("invalid");
    expect(h.mock.calls).toHaveLength(0);
  });

  it("GARDEN_READ_ONLY: keep, rest, compost and undo write nothing", async () => {
    process.env.GARDEN_READ_ONLY = "1";
    expect(await keepItem({ type: "rec", id: 7 })).toBe(false);
    expect(await restIdea(3)).toBe(false);
    expect(await compostTip(7)).toEqual({ changed: false, previous: null });
    expect(await undoCompostTip(7, "new")).toBe(false);
    expect(h.mock.calls).toHaveLength(0);
  });
});
