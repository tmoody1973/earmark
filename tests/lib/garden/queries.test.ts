import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeMockDb } from "../../helpers/mock-db";

const h = vi.hoisted(() => ({ mock: undefined as unknown as ReturnType<typeof import("../../helpers/mock-db").makeMockDb> }));
vi.mock("../../../agent/lib/db", () => ({ db: () => h.mock.sql }));
const status = vi.hoisted(() => ({
  setRecStatus: vi.fn(async () => ({ changed: true, previous: "needs_review" })),
  setRecRating: vi.fn(async () => ({ changed: true })),
}));
vi.mock("../../../agent/lib/recs/status", async (orig) => ({ ...(await orig<object>()), ...status }));

import {
  HIDDEN_TIP_STATUSES, getBloomsSince, getGardenView, getIdeaDetail, getMaybeTips, getRecommenderPage, getShelf, setTipChoice,
  setTipVerdict, toPlant,
  toRecCard,
} from "../../../agent/lib/garden/queries";

const recRow = {
  id: 7, type: "album", canonical_name: "Promises", creator: "Floating Points",
  year_or_address: "2021", image_url: "https://x/{w}x{h}bb.jpg", context_summary: "play it loud",
  excerpt: "you have to hear Promises", said_at: new Date("2026-10-15T15:00:00Z"),
  status: "new", rating: null, lat: null, lng: null,
  links: { apple_music: "https://music.apple.com/a" }, recommender_id: 3, first_name: "Ann",
};

describe("garden queries", () => {
  beforeEach(() => { h.mock = makeMockDb(); });

  it("a video tip is a screen card that opens what the rec lane stored: the video, else a YouTube search", () => {
    const video = { ...recRow, type: "video", canonical_name: "The Art of Code", creator: "Dylan Beattie", image_url: null };
    const search = "https://www.youtube.com/results?search_query=The%20Art%20of%20Code%20Dylan%20Beattie";
    expect(toRecCard({ ...video, links: { primary: search } })).toMatchObject({ variant: "screen", link: search });
    expect(toRecCard({ ...video, links: { youtube: "https://youtu.be/x", urls: ["https://youtu.be/x"] } }).link).toBe("https://youtu.be/x");
  });

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

  it("carries the Wikipedia note apart from the why, only with a Wikipedia https source (M3-T4b)", () => {
    const about = { about: "Floating Points is an English electronic musician.", about_url: "https://en.wikipedia.org/wiki/Floating_Points" };
    const card = toRecCard({ ...recRow, ...about });
    expect(card.about).toEqual({ text: about.about, url: about.about_url });
    expect(card.why).toBe("play it loud"); // never mixed into the why
    expect(toRecCard(recRow).about).toBeNull(); // a query that doesn't select it
    expect(toRecCard({ ...recRow, about: null, about_url: null }).about).toBeNull();
    expect(toRecCard({ ...recRow, ...about, about_url: "javascript:alert(1)" }).about).toBeNull();
    expect(toRecCard({ ...recRow, ...about, about_url: "https://evil.example/wiki/x" }).about).toBeNull();
  });

  it("maps a cluster row to a plant with level and flag", () => {
    const plant = toPlant({
      id: 1, title: "AI in public radio", stage: "ready", mention_count: 3,
      last_mentioned_at: new Date("2026-10-15T00:00:00Z"), pinned: true, flagged: true,
    });
    expect(plant).toMatchObject({ id: 1, level: "bloom", bloomed: true, pinned: true, flagged: true });
  });

  it("loads plants then shelf; the shelf shows only visible tips (one shared rule, decision 025)", async () => {
    h.mock.queue.push([], [recRow]);
    const view = await getGardenView();
    expect(view.shelf.map((c) => c.status)).toEqual(["new"]);
    expect(h.mock.calls[0].text).toContain("stage <> 'dismissed'");
    expect(h.mock.calls[1].text).toContain("r.status <> all(?::text[])");
    expect(h.mock.calls[1].values).toContain(HIDDEN_TIP_STATUSES);
    expect(h.mock.calls[1].text).not.toContain("raw_text");
  });

  it("hides dismissed, composted and maybe (needs_review) tips: maybes live only in the Maybe? row", () => {
    expect([...HIDDEN_TIP_STATUSES].sort()).toEqual(["composted", "dismissed", "needs_review"]);
  });

  it("matches the owner by first name even when the owner's full name is configured", () => {
    process.env.EARMARK_OWNER_FIRST_NAME = "Tarik Moody";
    try {
      expect(toRecCard({ ...recRow, first_name: "Tarik" }).recommender).toBeNull();
    } finally {
      delete process.env.EARMARK_OWNER_FIRST_NAME;
    }
  });

  it("reads the shelf alone with one query (the Shelf tab never loads plants)", async () => {
    h.mock.queue.push([recRow]);
    const shelf = await getShelf();
    expect(shelf).toHaveLength(1);
    expect(h.mock.calls).toHaveLength(1);
    expect(h.mock.calls[0].text).not.toContain("idea_clusters");
  });

  it("the shelf and a person's page select the Wikipedia note; the Maybe? row doesn't need it (M3-T4b)", async () => {
    const note = { about: "Floating Points is an English musician.", about_url: "https://en.wikipedia.org/wiki/Floating_Points" };
    h.mock.queue.push([{ ...recRow, ...note }]);
    expect((await getShelf())[0]!.about).toEqual({ text: note.about, url: note.about_url });
    h.mock = makeMockDb();
    h.mock.queue.push([{ ...recRow, ...note }]);
    const page = await getRecommenderPage(3);
    expect(h.mock.calls[0]!.text).toContain("r.about, r.about_url");
    expect(page!.recs[0]!.about).toEqual({ text: note.about, url: note.about_url });
  });

  it("a Bee todo's link (?rec=<id>) always shows its tip: one extra query adds it when past the newest 60", async () => {
    h.mock.queue.push([recRow], [{ ...recRow, id: 99, canonical_name: "Old one" }]);
    const shelf = await getShelf(99);
    expect(shelf.map((c) => c.id)).toEqual([7, 99]);
    expect(h.mock.calls).toHaveLength(2);
    expect(h.mock.calls[1].values).toContain(99);
    expect(h.mock.calls[1].text).toContain("<> all("); // a hidden (dismissed/composted) tip stays hidden

    h.mock = makeMockDb();
    h.mock.queue.push([recRow]);
    expect((await getShelf(7)).map((c) => c.id)).toEqual([7]);
    expect(h.mock.calls).toHaveLength(1);
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

  it("reads the Maybe? pile: needs_review only, newest first, 12 at most, and how many more wait", async () => {
    h.mock.queue.push([{ ...recRow, status: "needs_review", total: 15 }, { ...recRow, id: 8, status: "needs_review", total: 15 }]);
    const pile = await getMaybeTips();
    expect(pile.tips.map((t) => t.id)).toEqual([7, 8]);
    expect(pile.more).toBe(13);
    const text = h.mock.calls[0].text.replace(/\s+/g, " ");
    expect(text).toContain("r.status = 'needs_review'");
    expect(text).toMatch(/order by r\.said_at desc, r\.id desc limit \?/);
    expect(h.mock.calls[0].values.at(-1)).toBe(12);
    expect(text).not.toContain("raw_text");
    expect(text).not.toContain("excerpt");
  });

  it("an empty pile has nothing more", async () => {
    h.mock.queue.push([]);
    expect(await getMaybeTips()).toEqual({ tips: [], more: 0 });
  });
});

describe("setTipVerdict", () => {
  beforeEach(() => { h.mock = makeMockDb(); });
  afterEach(() => { delete process.env.GARDEN_READ_ONLY; });

  beforeEach(() => { status.setRecStatus.mockClear(); });

  it.each([["kept", "new"], ["not_a_tip", "dismissed"]] as const)(
    "%s moves a maybe to %s through setRecStatus with the verdict, only while it is still a maybe",
    async (verdict, next) => {
      expect(await setTipVerdict(7, verdict)).toBe(true);
      expect(status.setRecStatus).toHaveBeenCalledWith(7, next, "garden", { from: ["needs_review"], verdict });
    },
  );

  it("is a no-op (false) when the tip is no longer a maybe", async () => {
    status.setRecStatus.mockResolvedValueOnce({ changed: false, previous: null } as never);
    expect(await setTipVerdict(7, "kept")).toBe(false);
  });

  it("writes nothing during a read-only real-data e2e run", async () => {
    process.env.GARDEN_READ_ONLY = "1";
    expect(await setTipVerdict(7, "kept")).toBe(false);
    expect(h.mock.calls).toHaveLength(0);
    expect(status.setRecStatus).not.toHaveBeenCalled();
  });
});

// FR-22: Try this / Tried / a rating / Dismiss from a shelf card, through the status core with its from-guards.
describe("setTipChoice", () => {
  beforeEach(() => { h.mock = makeMockDb(); status.setRecStatus.mockClear(); status.setRecRating.mockClear(); });
  afterEach(() => { delete process.env.GARDEN_READ_ONLY; });
  const defer = vi.fn();

  it.each([
    ["queue", "queued", ["new"]],
    ["tried", "tried", ["new", "queued"]],
    ["dismiss", "dismissed", ["new", "queued"]],
  ] as const)("%s moves the tip to %s, only from a status the shelf shows", async (choice, next, from) => {
    expect(await setTipChoice(7, choice, { defer })).toBe(true);
    expect(status.setRecStatus).toHaveBeenCalledWith(7, next, "garden", { from, defer });
    expect(status.setRecRating).not.toHaveBeenCalled();
  });

  it.each(["loved", "fine", "not_for_me"] as const)("%s rates the tip through setRecRating", async (rating) => {
    expect(await setTipChoice(7, rating, { defer })).toBe(true);
    expect(status.setRecRating).toHaveBeenCalledWith(7, rating, "garden", { defer });
    expect(status.setRecStatus).not.toHaveBeenCalled();
  });

  it("is false when nothing changed (the tip moved on elsewhere, or already had that rating)", async () => {
    status.setRecStatus.mockResolvedValueOnce({ changed: false, previous: null } as never);
    expect(await setTipChoice(7, "queue")).toBe(false);
    status.setRecRating.mockResolvedValueOnce({ changed: false });
    expect(await setTipChoice(7, "loved")).toBe(false);
  });

  it("writes nothing during a read-only real-data e2e run", async () => {
    process.env.GARDEN_READ_ONLY = "1";
    expect(await setTipChoice(7, "dismiss")).toBe(false);
    expect(await setTipChoice(7, "loved")).toBe(false);
    expect(status.setRecStatus).not.toHaveBeenCalled();
    expect(status.setRecRating).not.toHaveBeenCalled();
  });
});
