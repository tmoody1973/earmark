import { describe, expect, it, vi } from "vitest";
import { describeSweep, findSweep, forgetSweep } from "../../agent/lib/privacy/forget-m5";

const episodes = [
  { id: "1", week_of: "2026-09-27", script_md: "Title\n\nAnn suggested a ramen spot.", audio_url: "https://blob.test/1.mp3" },
  { id: "2", week_of: "2026-10-04", script_md: "Title\n\nNobody here, just Joanna and Annabel.", audio_url: "https://blob.test/2.mp3" },
  { id: "3", week_of: "2026-10-11", script_md: "Title\n\nNo audio yet, nobody named.", audio_url: null },
];
const runs = [
  { id: "7", output_md: "## Pitch\nAnn's ramen tip.", status: "approved", created_at: new Date("2026-09-30T12:00:00Z") },
  { id: "8", output_md: "Nobody named here, only Annabel.", status: "draft", created_at: new Date("2026-10-01T12:00:00Z") },
  { id: "9", output_md: "This week, quietly.", status: "draft", created_at: new Date("2026-10-13T12:00:00Z") },
];
const SAVED = new Date("2026-10-08T15:00:00Z"); // a Thursday: the Chicago week of Sunday 2026-10-04

// A tagged-template sql fake: answers the two selects and records every statement (text with ? for values).
function fakeSql() {
  const calls: string[] = [];
  const sql = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?").replace(/\s+/g, " ").trim();
    calls.push(values.length ? `${text} ${values.join(",")}` : text);
    if (text.startsWith("select") && text.includes("from episodes")) return episodes;
    if (text.startsWith("select") && text.includes("from gardener_runs")) return runs;
    return [];
  });
  return { sql, calls };
}

describe("findSweep", () => {
  it("takes every episode from the item's save week and every draft made after it, plus anything naming the recommender", async () => {
    const s = await findSweep({ firstName: "Ann", savedAt: SAVED }, fakeSql().sql as never);
    expect(s.episodes.map((e) => e.id)).toEqual([1, 2, 3]);
    expect(s.drafts).toEqual([{ id: 7, awaitingApproval: false }, { id: 9, awaitingApproval: true }]);
  });
  it("by save time alone (an idea, no recommender), named or not", async () => {
    const s = await findSweep({ firstName: null, savedAt: SAVED }, fakeSql().sql as never);
    expect(s.episodes.map((e) => e.id)).toEqual([2, 3]);
    expect(s.drafts.map((d) => d.id)).toEqual([9]);
  });
  it("by name alone: whole word, any case", async () => {
    const s = await findSweep({ firstName: "ann", savedAt: null }, fakeSql().sql as never);
    expect(s.episodes.map((e) => e.id)).toEqual([1]);
    expect(s.drafts.map((d) => d.id)).toEqual([7]);
  });
  it("with neither a name nor a save time reads nothing", async () => {
    const { sql } = fakeSql();
    expect(await findSweep({ firstName: "  ", savedAt: null }, sql as never)).toEqual({ episodes: [], drafts: [] });
    expect(sql).not.toHaveBeenCalled();
  });
});

describe("describeSweep", () => {
  it("counts and dates only", () => {
    expect(describeSweep({
      episodes: [{ id: 3, weekOf: "2026-10-11", audioUrl: null }, { id: 2, weekOf: "2026-10-04", audioUrl: "x" }],
      drafts: [{ id: 9, awaitingApproval: true }, { id: 10, awaitingApproval: false }],
    })).toBe("2 episodes (weeks 2026-10-04–2026-10-11) and 2 drafts, including 1 awaiting approval");
    expect(describeSweep({ episodes: [{ id: 1, weekOf: "2026-10-04", audioUrl: null }], drafts: [{ id: 1, awaitingApproval: false }] }))
      .toBe("1 episode (week 2026-10-04) and 1 draft, including 0 awaiting approval");
    expect(describeSweep({ episodes: [], drafts: [] })).toBe("0 episodes and 0 drafts, including 0 awaiting approval");
  });
});

describe("forgetSweep", () => {
  it("deletes the drafts, then the episodes, then the Blob audio last", async () => {
    const { sql, calls } = fakeSql();
    const del = vi.fn(async (url: string) => { calls.push(`del ${url}`); });
    const out = await forgetSweep({ firstName: null, savedAt: SAVED }, { sql: sql as never, del });
    expect(out.audioDeleted).toBe(1);
    expect(calls.slice(2)).toEqual([
      "delete from gardener_runs where id = ? 9",
      "delete from episodes where id = ? 2",
      "delete from episodes where id = ? 3",
      "del https://blob.test/2.mp3",
    ]);
  });
  it("audio already gone (404) is done; any other Blob failure throws after the row deletes, so the forget rolls back", async () => {
    const gone = vi.fn(async () => { throw Object.assign(new Error("gone"), { status: 404 }); });
    expect((await forgetSweep({ firstName: null, savedAt: SAVED }, { sql: fakeSql().sql as never, del: gone })).audioDeleted).toBe(1);
    const { sql, calls } = fakeSql();
    const down = vi.fn(async () => { throw new Error("blob down"); });
    await expect(forgetSweep({ firstName: null, savedAt: SAVED }, { sql: sql as never, del: down })).rejects.toThrow("blob down");
    expect(calls.filter((c) => c.startsWith("delete"))).toHaveLength(3);
  });
});
