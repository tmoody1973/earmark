import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeMockDb } from "../../helpers/mock-db";

const h = vi.hoisted(() => ({ mock: undefined as unknown as ReturnType<typeof import("../../helpers/mock-db").makeMockDb> }));
vi.mock("../../../agent/lib/db", () => ({ db: () => h.mock.sql }));

import { searchEarmarks } from "../../../agent/lib/search/memory-cue";

const recRow = {
  id: 4, type: "place", canonical_name: "Ramen Kyuu", creator: null, year_or_address: "Brady St",
  image_url: null, context_summary: "get the spicy miso", said_at: "2026-09-12T01:00:00Z", status: "new", rating: null,
  lat: 43.04, lng: -87.91, links: {}, recommender_id: 3, first_name: "Ann",
};
const ideaRow = {
  id: 9, title: "A show about late-night cooks", stage: "sprouting", mention_count: 2, last_mentioned_at: "2026-09-20T02:00:00Z",
  pinned: false, flagged: false, confirmed: true, timeline: [], dismissed_at: [],
};
const neuralHit = (id: number, locations: string[] = []) => ({
  id, started_at: 0, stopped_at: 0, link: "", locations, short_summary: "dinner", detailed_summary: "",
});

beforeEach(() => { h.mock = makeMockDb(); });

describe("searchEarmarks", () => {
  it("passes who/where/when filters to SQL and maps neural conversation ids to items", async () => {
    h.mock.queue.push([recRow]);
    const neuralSearch = vi.fn(async () => ({ results: [neuralHit(900, ["Brady Street, Milwaukee"]), neuralHit(901, ["Downtown"])], total: 2 }));
    const since = new Date("2026-09-01T05:00:00Z");
    const until = new Date("2026-10-01T05:00:00Z");
    const out = await searchEarmarks(
      { who: "Ann", where: "Brady", when: { since, until }, query: "ramen at dinner" },
      { useNeural: true, bee: { neuralSearch } },
    );
    expect(neuralSearch).toHaveBeenCalledWith("ramen at dinner", { since: since.getTime(), until: until.getTime(), limit: 20 }, expect.any(AbortSignal));
    const { values } = h.mock.calls[0];
    expect(values).toContain("Ann");
    expect(values).toContain(since.toISOString());
    expect(values).toContain(until.toISOString());
    expect(values).toContain("%brady%");
    expect(values).toContain("%ramen at dinner%");
    expect(values).toContain(JSON.stringify([900, 901])); // what the query means
    expect(values).toContain(JSON.stringify([900])); // where Bee placed the conversation
    expect(out.recs[0]).toMatchObject({ id: 4, name: "Ramen Kyuu", recommender: { id: 3, firstName: "Ann" } });
    expect(out.neuralMatches).toBe(2);
    expect(out.neuralFailed).toBe(false);
  });

  it("skips Bee entirely when useNeural is false (MCP latency budget)", async () => {
    const neuralSearch = vi.fn();
    const out = await searchEarmarks({ query: "ramen" }, { useNeural: false, bee: { neuralSearch } });
    expect(neuralSearch).not.toHaveBeenCalled();
    expect(out.neuralMatches).toBe(0);
    expect(h.mock.calls).toHaveLength(2);
  });

  it("does not call Bee without a query: who/where/when alone are store filters", async () => {
    const neuralSearch = vi.fn();
    await searchEarmarks({ where: "Brady" }, { bee: { neuralSearch } });
    expect(neuralSearch).not.toHaveBeenCalled();
  });

  it("falls back to store matches when Bee fails, and says so", async () => {
    h.mock.queue.push([recRow], [ideaRow]);
    const neuralSearch = vi.fn(async () => { throw new Error("timeout"); });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await searchEarmarks({ query: "ramen" }, { bee: { neuralSearch } });
    spy.mockRestore();
    expect(out.neuralFailed).toBe(true);
    expect(out.neuralMatches).toBe(0);
    expect(out.recs.map((r) => r.id)).toEqual([4]);
    expect(out.ideas.map((i) => i.id)).toEqual([9]);
  });

  it("does not search ideas when a recommender is named (ideas are the owner's own)", async () => {
    await searchEarmarks({ who: "Ann" }, { useNeural: false });
    expect(h.mock.calls).toHaveLength(1);
  });

  it("maps idea rows to garden plants, and never matches dismissed ideas or mentions", async () => {
    h.mock.queue.push([], [ideaRow]);
    const out = await searchEarmarks({ query: "cooks" }, { useNeural: false });
    expect(out.ideas[0]).toMatchObject({ id: 9, title: "A show about late-night cooks", stage: "sprouting", mentionCount: 2 });
    const ideaSql = h.mock.calls[1].text;
    expect(ideaSql).toContain("c.stage <> 'dismissed'");
    expect(ideaSql).toContain("m.review_status <> 'dismissed'");
  });

  it("escapes LIKE wildcards in what the owner typed", async () => {
    await searchEarmarks({ query: "100%_\\" }, { useNeural: false });
    expect(h.mock.calls[0].values).toContain("%100\\%\\_\\\\%");
  });

  it("never selects raw_text or excerpts for a rec", async () => {
    await searchEarmarks({ query: "ramen" }, { useNeural: false });
    const select = h.mock.calls[0].text.split("from recommendations")[0];
    expect(select).not.toMatch(/raw_text|excerpt/);
  });
});
