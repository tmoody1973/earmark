import { describe, expect, it, vi } from "vitest";

const { results } = vi.hoisted(() => ({ results: [] as unknown[][] }));
vi.mock("../../../agent/lib/db", () => ({
  db: () => (_strings: TemplateStringsArray, ..._values: unknown[]) => Promise.resolve(results.shift() ?? []),
}));

import { listGardenItems } from "../../../agent/lib/store/garden";

describe("listGardenItems", () => {
  it("merges recs and ideas newest first with recommender first names", async () => {
    results.push(
      [{ id: "4", canonical_name: "Ardent", type: "place", excerpt: "you have to try Ardent", status: "new", said_at: "2026-10-16T15:00:00Z", first_name: "Ann" }],
      [{ id: "2", title: "House music segment", stage: "compost", mention_count: 1, last_mentioned_at: "2026-10-16T16:00:00Z" }],
    );
    const items = await listGardenItems(10);
    expect(items).toEqual([
      { kind: "idea", id: 2, title: "House music segment", stage: "compost", mentions: 1, at: new Date("2026-10-16T16:00:00Z") },
      { kind: "rec", id: 4, name: "Ardent", type: "place", recommender: "Ann", excerpt: "you have to try Ardent", status: "new", at: new Date("2026-10-16T15:00:00Z") },
    ]);
  });

  it("keeps an unknown recommender as null", async () => {
    results.push(
      [{ id: "5", canonical_name: "Kind of Blue", type: "album", excerpt: "listen to Kind of Blue", status: "needs_review", said_at: "2026-10-16T10:00:00Z", first_name: null }],
      [],
    );
    const [item] = await listGardenItems();
    expect(item).toMatchObject({ kind: "rec", recommender: null });
  });

  it("never carries raw transcript text", async () => {
    results.push(
      [{ id: "6", canonical_name: "X", type: "song", excerpt: "short", status: "new", said_at: "2026-10-16T10:00:00Z", first_name: "Ann", raw_text: "SECRET FULL TRANSCRIPT" }],
      [],
    );
    expect(JSON.stringify(await listGardenItems())).not.toContain("SECRET");
  });

  it("returns an empty list when there is nothing yet", async () => {
    results.push([], []);
    expect(await listGardenItems()).toEqual([]);
  });
});
