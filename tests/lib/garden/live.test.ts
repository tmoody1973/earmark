import { describe, expect, it } from "vitest";
import {
  BLOOM_POLL_MS, emptyLive, isBlooming, newTipsSince, parseBloomsResponse, pollDelay, reduceFeed, settleBloom, stableOrder,
  type DrawnPlant, type FeedEvent,
} from "../../../agent/lib/garden/live";
import type { PlantLevel } from "../../../agent/lib/garden/plant";

const now = "2026-10-20T18:00:00.000Z";
const ev = (id: number, kind: "mention" | "bloom", clusterId: number, over: Partial<FeedEvent> = {}): FeedEvent => ({
  id, kind, clusterId, title: `Idea ${clusterId}`, stage: kind === "bloom" ? "ready" : "sprouting", mentionCount: kind === "bloom" ? 3 : 2,
  createdAt: now, ...over,
});
const STAGE: Record<PlantLevel, DrawnPlant["stage"]> = { seed: "compost", sprout: "sprouting", bloom: "ready", fruit: "drafted", harvested: "used" };
const drawn = (level: PlantLevel, mentionCount = level === "seed" ? 1 : 2): DrawnPlant => ({ level, stage: STAGE[level], mentionCount });
const onPage = (entries: Array<[number, PlantLevel]>) => new Map(entries.map(([id, l]) => [id, drawn(l)] as const));

describe("parseBloomsResponse", () => {
  it("accepts the M2-T6 shape", () => {
    const r = parseBloomsResponse({ events: [ev(9, "bloom", 4)], now });
    expect(r.events[0]!.clusterId).toBe(4);
    expect(r.now).toBe(now);
  });
  it("throws a readable error when the endpoint shape drifts", () => {
    expect(() => parseBloomsResponse({ items: [] })).toThrow(/blooms response/);
  });
});

describe("tips on the live page", () => {
  it("an older server reply without tipsAt still parses (null)", () => {
    expect(parseBloomsResponse({ events: [], now: "2026-10-17T15:00:00.000Z" }).tipsAt).toBeNull();
  });
  it("refreshes once per newer tip change: never for none, an older or the same time", () => {
    const seen = "2026-10-17T15:00:00.000Z";
    expect(newTipsSince(seen, null)).toBe(false);
    expect(newTipsSince(seen, "2026-10-17T14:59:59.000Z")).toBe(false);
    expect(newTipsSince(seen, seen)).toBe(false);
    expect(newTipsSince(seen, "2026-10-17T15:00:01.000Z")).toBe(true);
  });
});

describe("pollDelay", () => {
  it("polls every 5 s while healthy and backs off on errors, capped at a minute", () => {
    expect([0, 1, 2, 3, 4, 9].map(pollDelay)).toEqual([BLOOM_POLL_MS, 10_000, 20_000, 40_000, 60_000, 60_000]);
  });
});

describe("reduceFeed", () => {
  it("a bloom on a visible sprout: plant patched to bloom, remembering how it was drawn; chip and announcement, no refresh", () => {
    const { state, refresh } = reduceFeed(emptyLive(), [ev(1, "mention", 4, { stage: "ready", mentionCount: 3 }), ev(2, "bloom", 4, { title: "Station crates" })], onPage([[4, "sprout"]]));
    expect(state.patches[4]).toEqual({ stage: "ready", level: "bloom", mentionCount: 3, bloomFrom: { level: "sprout", stage: "sprouting", mentionCount: 2 } });
    expect(state.chips).toEqual([
      { key: "idea-4", kind: "bloom", title: "Station crates", from: null, meta: "Bloomed · 3 mentions", at: now, href: "/ideas/4" },
    ]);
    expect(state.announcement).toBe("Station crates bloomed — mentioned 3 times.");
    expect(refresh).toBe(false); // the plant blooms in place; re-sorting the bed mid-animation would move it
  });

  it("a mention on a visible idea updates its count quietly and asks for a refresh (newest timeline line)", () => {
    const { state, refresh } = reduceFeed(emptyLive(), [ev(5, "mention", 4)], onPage([[4, "seed"]]));
    expect(state.patches[4]).toEqual({ stage: "sprouting", level: "sprout", mentionCount: 2, bloomFrom: null });
    expect(state.chips).toEqual([]);
    expect(state.announcement).toBe("");
    expect(refresh).toBe(true);
  });

  it("a bloom after an earlier live mention remembers the patched drawing, not the server's", () => {
    const a = reduceFeed(emptyLive(), [ev(5, "mention", 4)], onPage([[4, "seed"]]));
    const b = reduceFeed(a.state, [ev(6, "bloom", 4)], onPage([[4, "seed"]]));
    expect(b.state.patches[4]!.bloomFrom).toEqual({ level: "sprout", stage: "sprouting", mentionCount: 2 });
  });

  it("events seen before are ignored (the route re-sends a 10 s overlap on purpose)", () => {
    const first = reduceFeed(emptyLive(), [ev(2, "bloom", 4)], onPage([[4, "sprout"]]));
    const again = reduceFeed(first.state, [ev(2, "bloom", 4)], onPage([[4, "sprout"]]));
    expect(again.state).toBe(first.state);
    expect(again.refresh).toBe(false);
  });

  it("a bloom for an idea not on the page still chips and announces, and refreshes to bring it in", () => {
    const { state, refresh } = reduceFeed(emptyLive(), [ev(3, "bloom", 99)], onPage([[4, "sprout"]]));
    expect(state.patches[99]!.bloomFrom).toBeNull();
    expect(state.chips.map((c) => c.key)).toEqual(["idea-99"]);
    expect(refresh).toBe(true);
  });

  it("a plant that was already in flower does not replay the bloom", () => {
    const { state } = reduceFeed(emptyLive(), [ev(3, "bloom", 4, { stage: "drafted", mentionCount: 4 })], onPage([[4, "bloom"]]));
    expect(state.patches[4]).toEqual({ stage: "drafted", level: "fruit", mentionCount: 4, bloomFrom: null });
  });

  it("two blooms in one poll: newest chip first, both announced, no duplicate chips later", () => {
    const a = reduceFeed(emptyLive(), [ev(1, "bloom", 1, { title: "A" }), ev(2, "bloom", 2, { title: "B", mentionCount: 4 })], onPage([[1, "seed"], [2, "sprout"]]));
    expect(a.state.chips.map((c) => c.key)).toEqual(["idea-2", "idea-1"]);
    expect(a.state.announcement).toBe("A bloomed — mentioned 3 times. B bloomed — mentioned 4 times.");
    const b = reduceFeed(a.state, [ev(7, "bloom", 1, { title: "A", mentionCount: 5 })], onPage([[1, "bloom"], [2, "bloom"]]));
    expect(b.state.chips.map((c) => c.key)).toEqual(["idea-1", "idea-2"]);
    expect(b.state.chips[0]!.meta).toBe("Bloomed · 5 mentions");
  });

  it("does not mutate the previous state", () => {
    const s0 = emptyLive();
    reduceFeed(s0, [ev(1, "bloom", 1)], onPage([[1, "seed"]]));
    expect(s0.seen.size).toBe(0);
    expect(s0.patches).toEqual({});
  });
});

describe("settleBloom / isBlooming", () => {
  it("clears the animation marker once the bloom has played, keeping the new state", () => {
    const { state } = reduceFeed(emptyLive(), [ev(2, "bloom", 4)], onPage([[4, "sprout"]]));
    expect(isBlooming(state)).toBe(true);
    const settled = settleBloom(state, 4);
    expect(settled.patches[4]).toEqual({ stage: "ready", level: "bloom", mentionCount: 3, bloomFrom: null });
    expect(isBlooming(settled)).toBe(false);
    expect(state.patches[4]!.bloomFrom).not.toBeNull();
  });
});

describe("stableOrder (no re-sort under his thumb until the next visit)", () => {
  it("ids already shown keep their places; ids new to the page come first, in the server's order", () => {
    expect(stableOrder([3, 9, 1, 2], [1, 2, 3])).toEqual([9, 1, 2, 3]);
  });
  it("an id that left the page is simply gone; nothing remembered means the server's order", () => {
    expect(stableOrder([2, 1], [1, 5, 2])).toEqual([1, 2]);
    expect(stableOrder([2, 1], [])).toEqual([2, 1]);
  });
});
