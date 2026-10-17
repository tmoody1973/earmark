import { beforeEach, describe, expect, it, vi } from "vitest";

const sql = vi.fn();
vi.mock("../../../agent/lib/db", () => ({ db: () => sql }));
const search = vi.fn();
vi.mock("../../../agent/lib/search/memory-cue", () => ({ searchEarmarks: (...a: unknown[]) => search(...a) }));
const addToPlaylist = vi.fn();
vi.mock("../../../agent/lib/mcp/playlist-seam", () => ({ addRecToPlaylist: (...a: unknown[]) => addToPlaylist(...a) }));
import { addToEarmarkedPlaylist, latestEpisode, readyIdeas, searchEarmarksTool, spokenOpening, whatDidTheyRecommend } from "../../../agent/lib/mcp/tools";

const rec = (name: string, first: string | null) => ({ id: 1, name, recommender: first ? { id: 2, firstName: first } : null });
const found = (recs: unknown[], ideas: unknown[] = []) => ({ recs, ideas, neuralMatches: 0, neuralFailed: false });

beforeEach(() => { sql.mockReset(); search.mockReset(); addToPlaylist.mockReset(); });

describe("MCP tools", () => {
  it("what_did_they_recommend speaks a short list", async () => {
    sql.mockResolvedValueOnce([{ canonical_name: "Ramen Kyuu", creator: null, type: "place" }, { canonical_name: "Promises", creator: "Floating Points", type: "album" }]);
    const out = await whatDidTheyRecommend({ person: "ann", period: "month" });
    expect(out.text).toBe("Ann recommended 2 things: Ramen Kyuu (place); Promises by Floating Points (album).");
    expect(sql.mock.calls[0].slice(1)).toContain("ann");
  });
  it("what_did_they_recommend says so when there is nothing", async () => {
    sql.mockResolvedValueOnce([]);
    expect((await whatDidTheyRecommend({ person: "Bo", period: "week" })).text).toBe("No recommendations from Bo in the last week.");
  });
  it("search_earmarks never calls Bee neural search (500 ms budget)", async () => {
    search.mockResolvedValueOnce(found([]));
    await searchEarmarksTool({ who: "Ann", when: "in September" });
    expect(search.mock.calls[0][1]).toEqual({ useNeural: false });
    expect(search.mock.calls[0][0].when.since).toBeInstanceOf(Date);
  });
  it("search_earmarks reads garden card shapes (first name, not an object)", async () => {
    search.mockResolvedValueOnce(found(
      [rec("Ramen Kyuu", "Ann"), rec("Promises", null)],
      [{ id: 3, title: "AI in public radio", mentionCount: 4 }],
    ));
    expect((await searchEarmarksTool({ who: "Ann" })).text).toBe('I found: Ramen Kyuu from Ann; Promises; your idea "AI in public radio".');
  });
  it("search_earmarks says when nothing matched", async () => {
    search.mockResolvedValueOnce(found([]));
    expect((await searchEarmarksTool({ query: "x" })).text).toBe("Nothing matched those clues.");
  });
  it("search_earmarks explains an unparseable when", async () => {
    expect((await searchEarmarksTool({ when: "at that party" })).text).toMatch(/didn't understand/);
    expect(search).not.toHaveBeenCalled();
  });
  it("search_earmarks refuses an invalid coordinate cue before searching", async () => {
    for (const where of [{ lat: NaN, lng: 1, radiusM: 100 }, { lat: 1, lng: Infinity, radiusM: 100 }, { lat: 1, lng: 1, radiusM: 0 }, { lat: 1, lng: 1, radiusM: -5 }]) {
      expect((await searchEarmarksTool({ where })).text).toMatch(/didn't understand that place/);
    }
    expect(search).not.toHaveBeenCalled();
    search.mockResolvedValueOnce(found([]));
    await searchEarmarksTool({ where: { lat: 43, lng: -87.9, radiusM: 500 } });
    expect(search).toHaveBeenCalledTimes(1);
  });
  it("ready_ideas lists ready and drafted ideas", async () => {
    sql.mockResolvedValueOnce([{ title: "AI in public radio", mention_count: 4 }]);
    expect((await readyIdeas()).text).toBe("1 idea is ready: AI in public radio (4 mentions).");
    sql.mockResolvedValueOnce([]);
    expect((await readyIdeas()).text).toBe("No ideas are ready yet.");
  });
  it("add_to_earmarked_playlist only adds a matching music rec", async () => {
    sql.mockResolvedValueOnce([]);
    expect((await addToEarmarkedPlaylist({ item: "nothing" })).text).toMatch(/couldn't find/);
    sql.mockResolvedValueOnce([{ id: 9, canonical_name: "Promises" }]);
    addToPlaylist.mockResolvedValueOnce("added");
    expect((await addToEarmarkedPlaylist({ item: "promises" })).text).toBe("Added Promises to your Earmarked playlist.");
    expect(addToPlaylist).toHaveBeenCalledWith(9);
  });
  it("add_to_earmarked_playlist turns every seam outcome into a friendly message", async () => {
    const want: Record<string, RegExp> = {
      not_connected: /^Your Earmarked playlist isn't connected yet\.$/,
      no_auth: /reconnected/, no_match: /couldn't find Promises in Apple Music/,
      already: /already in your Earmarked playlist/, not_music: /isn't a music recommendation/,
    };
    for (const [outcome, re] of Object.entries(want)) {
      sql.mockResolvedValueOnce([{ id: 9, canonical_name: "Promises" }]);
      addToPlaylist.mockResolvedValueOnce(outcome);
      expect((await addToEarmarkedPlaylist({ item: "promises" })).text).toMatch(re);
    }
  });
  it("latest_episode speaks the week as a date, skips the title, and never returns the audio address", async () => {
    sql.mockResolvedValueOnce([{ week_of: "2026-10-12", script: "# Ann sent you to ramen\n\nThis week **Ann** pointed you at ramen." }]);
    const out = await latestEpisode();
    expect(out.text).toBe("This week's Earmark episode (the week of October 12) starts: This week Ann pointed you at ramen.");
    expect(out).not.toHaveProperty("audioUrl");
    const strings = sql.mock.calls[0][0] as string[];
    expect(strings.join("?")).toContain("week_of::text");
    sql.mockResolvedValueOnce([]);
    expect((await latestEpisode()).text).toMatch(/no published episode/);
  });
  it("latest_episode never speaks a raw Date, even if the driver returned one", async () => {
    sql.mockResolvedValueOnce([{ week_of: new Date("2026-10-12T00:00:00Z"), script: "Title\nHello there." }]);
    const { text } = await latestEpisode();
    expect(text).not.toMatch(/GMT|00:00:00/);
    expect(text).toContain("October 12");
  });
  it("spokenOpening cuts long scripts on a sentence, else a word, within 300 chars", () => {
    const sentences = Array.from({ length: 30 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
    const a = spokenOpening(`Title\n${sentences}`);
    expect(a.length).toBeLessThanOrEqual(300);
    expect(a.endsWith(".")).toBe(true);
    const b = spokenOpening(`Title\n${"word ".repeat(100)}`);
    expect(b.length).toBeLessThanOrEqual(301);
    expect(b.endsWith("word\u2026")).toBe(true);
  });
});
