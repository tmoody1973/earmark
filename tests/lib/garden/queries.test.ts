import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeMockDb } from "../../helpers/mock-db";

const h = vi.hoisted(() => ({ mock: undefined as unknown as ReturnType<typeof import("../../helpers/mock-db").makeMockDb> }));
vi.mock("../../../agent/lib/db", () => ({ db: () => h.mock.sql }));

import { getGardenView, getShelf, toPlant, toRecCard } from "../../../agent/lib/garden/queries";

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
});
