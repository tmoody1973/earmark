import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeMockDb } from "../../helpers/mock-db";

const h = vi.hoisted(() => ({ mock: undefined as unknown as ReturnType<typeof import("../../helpers/mock-db").makeMockDb> }));
vi.mock("../../../agent/lib/db", () => ({ db: () => h.mock.sql }));

import { getBloomsSince, getGardenView, getIdeaDetail, getShelf, toPlant, toRecCard } from "../../../agent/lib/garden/queries";

const recRow = {
  id: 7, type: "album", canonical_name: "Promises", creator: "Floating Points",
  year_or_address: "2021", image_url: "https://x/{w}x{h}bb.jpg", context_summary: "play it loud",
  excerpt: "you have to hear Promises", said_at: new Date("2026-10-15T15:00:00Z"),
  status: "new", rating: null, lat: null, lng: null,
  links: { apple_music: "https://music.apple.com/a" }, recommender_id: 3, first_name: "Ann",
};

describe("garden queries", () => {
  beforeEach(() => { h.mock = makeMockDb(); });

  it("maps a rec row to card data", () => {
    const card = toRecCard(recRow);
    expect(card).toMatchObject({
      id: 7, type: "album", variant: "cover", name: "Promises", creator: "Floating Points",
      imageUrl: "https://x/600x600bb.jpg", link: "https://music.apple.com/a", why: "play it loud",
      recommender: { id: 3, firstName: "Ann" }, saidAt: "2026-10-15T15:00:00.000Z",
    });
  });

  it("maps a missing recommender to null, never a placeholder name", () => {
    expect(toRecCard({ ...recRow, recommender_id: null, first_name: null }).recommender).toBeNull();
    expect(toRecCard({ ...recRow, first_name: "  " }).recommender).toBeNull();
  });

  it("never credits the garden's owner as a recommender, whatever the stored row says", () => {
    process.env.EARMARK_OWNER_FIRST_NAME = "Tarik";
    try {
      expect(toRecCard({ ...recRow, first_name: "tarik" }).recommender).toBeNull();
      expect(toRecCard(recRow).recommender).toEqual({ id: 3, firstName: "Ann" });
    } finally {
      delete process.env.EARMARK_OWNER_FIRST_NAME;
    }
  });

  it("keeps the why empty when there is no context summary (the excerpt never stands in)", () => {
    expect(toRecCard({ ...recRow, context_summary: null }).why).toBeNull();
  });

  it("maps a cluster row to a plant with level and flag", () => {
    const plant = toPlant({
      id: 1, title: "AI in public radio", stage: "ready", mention_count: 3,
      last_mentioned_at: new Date("2026-10-15T00:00:00Z"), pinned: true, flagged: true,
    });
    expect(plant).toMatchObject({ id: 1, level: "bloom", bloomed: true, pinned: true, flagged: true });
  });

  it("loads plants then shelf; hides dismissed and composted tips but keeps unconfirmed ones (marked on the card)", async () => {
    h.mock.queue.push([], [recRow, { ...recRow, id: 8, status: "needs_review" }]);
    const view = await getGardenView();
    expect(view.shelf.map((c) => c.status)).toEqual(["new", "needs_review"]);
    expect(h.mock.calls[0].text).toContain("stage <> 'dismissed'");
    expect(h.mock.calls[1].text).toContain("not in ('dismissed','composted')");
    expect(h.mock.calls[1].text).not.toContain("raw_text");
  });

  it("reads the shelf alone with one query (the Shelf tab never loads plants)", async () => {
    h.mock.queue.push([recRow]);
    const shelf = await getShelf();
    expect(shelf).toHaveLength(1);
    expect(h.mock.calls).toHaveLength(1);
    expect(h.mock.calls[0].text).not.toContain("idea_clusters");
  });

  it("marks a plant unconfirmed and carries its newest line by date", () => {
    const plant = toPlant({
      id: 2, title: "Station crates", stage: "sprouting", mention_count: 2, last_mentioned_at: null, pinned: false,
      flagged: false, confirmed: false,
      timeline: [{ date: "2026-10-12T00:00:00Z", line: "Oct 11: added crates" }, { date: "2026-10-01T00:00:00Z", line: "Sep 30: first heard" }],
    });
    expect(plant).toMatchObject({ confirmed: false, latestLine: "Oct 11: added crates" });
  });

  it("returns null for a missing idea", async () => {
    h.mock.queue.push([]);
    expect(await getIdeaDetail(999)).toBeNull();
    expect(h.mock.calls).toHaveLength(1);
  });

  it("loads a dismissed idea (shown greyed) but never selects a dismissed mention's excerpt", async () => {
    h.mock.queue.push(
      [{ id: 5, title: "Old idea", stage: "dismissed", mention_count: 2, last_mentioned_at: "2026-10-02T00:00:00Z",
        first_mentioned_at: "2026-10-01T00:00:00Z", pinned: false, flagged: false, confirmed: true, timeline: [],
        draft_md: null, draft_format: null, notion_page_id: null }],
      [{ id: 1, spoken_at: "2026-10-01T00:00:00Z", source: "ambient", review_status: "dismissed", excerpt: null }],
    );
    const idea = await getIdeaDetail(5);
    expect(idea?.plant.stage).toBe("dismissed");
    expect(h.mock.calls[0].text).not.toContain("stage <> 'dismissed'");
    expect(h.mock.calls[1].text).toContain("when review_status = 'dismissed' then null else excerpt");
    expect(idea?.mentions[0]).toMatchObject({ excerpt: null, reviewStatus: "dismissed" });
  });

  it("never puts a dismissed mention's note on the card (latestLine skips it)", () => {
    const plant = toPlant({
      id: 3, title: "Crates", stage: "sprouting", mention_count: 1, last_mentioned_at: null, pinned: false,
      flagged: false, confirmed: true,
      timeline: [{ date: "2026-10-01T00:00:00Z", line: "Oct 1: first heard" }, { date: "2026-10-05T00:00:00Z", line: "Oct 5: a dismissed note" }],
      dismissed_at: [new Date("2026-10-05T00:00:00Z")],
    });
    expect(plant.latestLine).toBe("Oct 1: first heard");
  });

  it("builds the New row from tips caught and blooms recorded after the visit baseline", async () => {
    const since = "2026-10-15T12:00:00.000Z";
    h.mock.queue.push(
      [],
      [{ ...recRow, created_at: "2026-10-15T16:00:00Z" }, { ...recRow, id: 8, created_at: "2026-10-15T09:00:00Z" }],
      [{ cluster_id: 4, created_at: "2026-10-15T14:00:00Z", title: "Station crates", mention_count: 3 }],
    );
    const view = await getGardenView(since);
    expect(view.newChips.map((c) => c.key)).toEqual(["rec-7", "idea-4"]);
    expect(h.mock.calls[2].text).toContain("e.kind = 'bloom'");
    expect(h.mock.calls[2].values).toContain(since);
  });

  it("keeps the NEWEST blooms (latest per idea, then newest first, capped to the row)", async () => {
    h.mock.queue.push([
      { cluster_id: 4, created_at: "2026-10-15T14:00:00Z", title: "B", mention_count: 3 },
      { cluster_id: 2, created_at: "2026-10-15T10:00:00Z", title: "A", mention_count: 4 },
    ]);
    const blooms = await getBloomsSince(null);
    expect(blooms.map((b) => b.clusterId)).toEqual([4, 2]);
    const text = h.mock.calls[0].text.replace(/\s+/g, " ");
    expect(text).toMatch(/distinct on \(e\.cluster_id\).*order by e\.cluster_id, e\.created_at desc/);
    expect(text).toMatch(/\) b order by b\.created_at desc limit \?/); // newest across ideas, after the per-idea pick
    expect(h.mock.calls[0].values.at(-1)).toBe(12);
  });

  it("reads the dismissed mention times with the plants", async () => {
    h.mock.queue.push([], []);
    await getGardenView();
    expect(h.mock.calls[0].text).toContain("review_status = 'dismissed'");
  });
});
