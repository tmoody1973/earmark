import { describe, expect, it } from "vitest";
import { VISIT_GAP_MS, newSince, nextVisit, parseVisit } from "../../../agent/lib/garden/visit";
import type { RecCardData } from "../../../agent/lib/garden/queries";

const at = (s: string) => new Date(s);

describe("nextVisit", () => {
  it("first ever visit: nothing to compare against, starts the record", () => {
    expect(nextVisit(null, at("2026-10-20T18:00:00Z"))).toEqual({
      since: null,
      next: { seenBefore: null, lastVisit: "2026-10-20T18:00:00.000Z" },
      started: true,
    });
  });

  it("a return after the gap compares against the last time he looked", () => {
    const prev = { seenBefore: "2026-10-19T08:00:00.000Z", lastVisit: "2026-10-20T09:00:00.000Z" };
    expect(nextVisit(prev, at("2026-10-20T18:00:00Z"))).toEqual({
      since: "2026-10-20T09:00:00.000Z",
      next: { seenBefore: "2026-10-20T09:00:00.000Z", lastVisit: "2026-10-20T18:00:00.000Z" },
      started: true,
    });
  });

  it("a reload inside the same visit (live refresh, back from an idea) keeps the same baseline", () => {
    const prev = { seenBefore: "2026-10-20T09:00:00.000Z", lastVisit: "2026-10-20T18:00:00.000Z" };
    const now = new Date(Date.parse(prev.lastVisit) + VISIT_GAP_MS - 1);
    expect(nextVisit(prev, now)).toEqual({
      since: "2026-10-20T09:00:00.000Z",
      next: { seenBefore: "2026-10-20T09:00:00.000Z", lastVisit: now.toISOString() },
      started: false,
    });
  });

  it("never moves the record backwards when a clock is behind", () => {
    const prev = { seenBefore: "2026-10-20T09:00:00.000Z", lastVisit: "2026-10-20T18:00:00.000Z" };
    const r = nextVisit(prev, at("2026-10-20T17:00:00Z"));
    expect(r.since).toBe("2026-10-20T09:00:00.000Z");
    expect(r.next.lastVisit).toBe("2026-10-20T18:00:00.000Z");
  });
});

describe("parseVisit", () => {
  it("reads the stored record and refuses anything else", () => {
    expect(parseVisit('{"seenBefore":null,"lastVisit":"2026-10-20T18:00:00.000Z"}')).toEqual({
      seenBefore: null,
      lastVisit: "2026-10-20T18:00:00.000Z",
    });
    expect(parseVisit(null)).toBeNull();
    expect(parseVisit("not json")).toBeNull();
    expect(parseVisit('{"lastVisit":"yesterday"}')).toBeNull();
  });
});

const card = (id: number, over: Partial<RecCardData> = {}): RecCardData => ({
  id, type: "place", variant: "map", name: `Tip ${id}`, creator: null, yearOrAddress: null, imageUrl: null, why: null,
  recommender: { id: 1, firstName: "Ann" }, saidAt: "2026-10-20T10:00:00.000Z", createdAt: "2026-10-20T10:00:00.000Z",
  status: "new", rating: null, lat: null, lng: null, link: null, ...over,
});

describe("newSince", () => {
  const since = "2026-10-20T09:00:00.000Z";

  it("lists tips caught and ideas bloomed after the baseline, newest first", () => {
    const chips = newSince(
      since,
      [
        card(1, { createdAt: "2026-10-20T08:59:59.000Z" }), // before: not new
        card(2, { createdAt: "2026-10-20T11:00:00.000Z", type: "album", name: "Acts of Faith", recommender: { id: 2, firstName: "Marcus" } }),
        card(3, { createdAt: "2026-10-20T12:00:00.000Z", type: "film_tv", name: "Shogun", recommender: null }),
      ],
      [{ clusterId: 7, title: "Station crates", mentionCount: 3, at: "2026-10-20T11:30:00.000Z" }],
    );
    expect(chips).toEqual([
      { key: "rec-3", kind: "rec", type: "film_tv", title: "Shogun", from: null, meta: "film / TV", at: "2026-10-20T12:00:00.000Z", href: "/shelf#rec-3" },
      { key: "idea-7", kind: "bloom", title: "Station crates", from: null, meta: "Bloomed · 3 mentions", at: "2026-10-20T11:30:00.000Z", href: "/ideas/7" },
      { key: "rec-2", kind: "rec", type: "album", title: "Acts of Faith", from: "Marcus", meta: "from Marcus · album", at: "2026-10-20T11:00:00.000Z", href: "/shelf#rec-2" },
    ]);
  });

  it("on the first visit everything counts, capped so the row stays a glance", () => {
    const many = Array.from({ length: 30 }, (_, i) => card(i + 1, { createdAt: new Date(Date.UTC(2026, 9, 1, i)).toISOString() }));
    const chips = newSince(null, many, []);
    expect(chips).toHaveLength(12);
    expect(chips[0]!.key).toBe("rec-30");
  });

  it("does not list a tip that is already tried or a dismissed idea's bloom twice", () => {
    const chips = newSince(since, [card(4, { createdAt: "2026-10-20T11:00:00.000Z", status: "tried" })], [
      { clusterId: 8, title: "One", mentionCount: 3, at: "2026-10-20T10:00:00.000Z" },
      { clusterId: 8, title: "One", mentionCount: 4, at: "2026-10-20T10:30:00.000Z" },
    ]);
    expect(chips.map((c) => c.key)).toEqual(["idea-8"]);
    expect(chips[0]!.meta).toBe("Bloomed · 4 mentions");
  });
});
