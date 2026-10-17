import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeMockDb } from "../../helpers/mock-db";

const h = vi.hoisted(() => ({ mock: undefined as unknown as ReturnType<typeof import("../../helpers/mock-db").makeMockDb> }));
vi.mock("../../../agent/lib/db", () => ({ db: () => h.mock.sql }));

import { getBacklinks, setLinkStatus } from "../../../agent/lib/garden/backlinks";
import { HIDDEN_TIP_STATUSES } from "../../../agent/lib/garden/queries";
import { LINK_MIN, MERGE_MIN } from "../../../agent/lib/links/criteria";

const key = { fromType: "idea", fromId: 1, toType: "idea", toId: 2, kind: "related" } as const;

describe("setLinkStatus", () => {
  beforeEach(() => { h.mock = makeMockDb(); });
  afterEach(() => { delete process.env.GARDEN_READ_ONLY; });

  it("accepts only a link that is still a suggestion (never revives a removed one)", async () => {
    h.mock.queue.push([{ kind: "related" }]);
    expect(await setLinkStatus(key, "accepted")).toBe(true);
    expect(h.mock.calls[0].text).toMatch(/status = 'suggested'/);
    expect(h.mock.calls[0].values).toEqual(expect.arrayContaining(["accepted", "idea", "1", "idea", "2", "related"]));
  });

  it("removes a suggested or accepted link, and reports false when nothing matched", async () => {
    h.mock.queue.push([]);
    expect(await setLinkStatus(key, "removed")).toBe(false);
    expect(h.mock.calls[0].text).toMatch(/status <> 'removed'/);
  });

  it("is a no-op on a read-only e2e run", async () => {
    process.env.GARDEN_READ_ONLY = "1";
    expect(await setLinkStatus(key, "removed")).toBe(false);
    expect(h.mock.calls).toHaveLength(0);
  });
});

describe("getBacklinks", () => {
  beforeEach(() => { h.mock = makeMockDb(); });

  it("reads ideas and tips through the shared visibility rules and the confidence floors", async () => {
    await getBacklinks(7);
    const all = h.mock.calls.map((c) => c.text).join("\n");
    const values = h.mock.calls.flatMap((c) => c.values);
    expect(values).toContain(HIDDEN_TIP_STATUSES); // a maybe, dismissed or composted tip never shows as a backlink
    expect(values).toContain(LINK_MIN);
    expect(values).toContain(MERGE_MIN);
    expect(all).toMatch(/stage <> 'dismissed'/);
    expect(all).toMatch(/status <> 'removed'/);
  });

  it("shapes rows: the other idea of a pair either way round, tips as cards, merges both ways", async () => {
    h.mock.queue.push(
      [ // idea links
        { kind: "related", link_status: "suggested", from_id: "7", to_id: "9", id: 9, title: "Nine", stage: "sprouting", mention_count: 2, last_mentioned_at: null, pinned: false, flagged: false, confirmed: true, timeline: [] },
        { kind: "merge_suggestion", link_status: "suggested", from_id: "3", to_id: "7", id: 3, title: "Three", stage: "compost", mention_count: 1, last_mentioned_at: null, pinned: false, flagged: false, confirmed: true, timeline: [] },
      ],
      [ // tips that fit
        { link_status: "accepted", from_id: "11", id: 11, type: "album", canonical_name: "A synthetic album", creator: null, year_or_address: null, image_url: null, context_summary: null, said_at: "2026-10-10T00:00:00Z", created_at: "2026-10-10T00:00:00Z", status: "new", rating: null, lat: null, lng: null, links: {}, recommender_id: null, first_name: null },
      ],
      [ // merges
        { merge_id: 4, keep_id: 7, merged_id: 8, title: "Eight", merged_at: "2026-10-16T00:00:00Z" },
        { merge_id: 5, keep_id: 6, merged_id: 7, title: "Six", merged_at: "2026-10-16T01:00:00Z" },
      ],
    );
    const b = await getBacklinks(7);
    expect(b.related).toHaveLength(1);
    expect(b.related[0]).toMatchObject({ status: "suggested", plant: { id: 9, title: "Nine" }, key: { fromType: "idea", fromId: 7, toType: "idea", toId: 9, kind: "related" } });
    expect(b.sameIdea[0]).toMatchObject({ plant: { id: 3 }, key: { fromId: 3, toId: 7, kind: "merge_suggestion" } });
    expect(b.fits[0]).toMatchObject({ status: "accepted", rec: { id: 11, name: "A synthetic album" }, key: { fromType: "rec", fromId: 11, toId: 7, kind: "fits" } });
    expect(b.mergedIn).toEqual([{ mergeId: 4, ideaId: 8, title: "Eight", at: "2026-10-16T00:00:00.000Z" }]);
    expect(b.mergedInto).toEqual({ mergeId: 5, ideaId: 6, title: "Six", at: "2026-10-16T01:00:00.000Z" });
  });
});
