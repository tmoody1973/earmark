import { describe, expect, it, vi } from "vitest";
import { forgetPersonInEpisodes, forgetPersonInGardenerRuns } from "../../agent/lib/privacy/forget-m5";

const rows = [
  { id: "1", script_md: "Title\n\nAnn suggested a ramen spot.", audio_url: "https://blob.test/1.mp3" },
  { id: "2", script_md: "Title\n\nNobody here, just Joanna and Annabel.", audio_url: "https://blob.test/2.mp3" },
  { id: "3", script_md: "Title\n\nNo audio yet, but ann is named.", audio_url: null },
];

describe("forgetPersonInEpisodes", () => {
  it("deletes rows, then Blob audio, only for episodes naming the person (whole word, any case)", async () => {
    const order: string[] = [];
    const sql = vi.fn(async () => { order.push("sql"); return order.length === 1 ? rows : []; });
    const del = vi.fn(async () => { order.push("del"); });
    const out = await forgetPersonInEpisodes("Ann", { sql: sql as never, del });
    expect(out).toEqual({ episodeIds: [1, 3], audioDeleted: 1 });
    expect(del).toHaveBeenCalledWith("https://blob.test/1.mp3");
    expect(order).toEqual(["sql", "sql", "sql", "del"]); // one select, two deletes, then the audio
  });
  it("throws on a Blob failure other than not-found, after the row deletes (the caller's transaction rolls them back)", async () => {
    const sql = vi.fn().mockResolvedValueOnce(rows).mockResolvedValue([]);
    const del = vi.fn(async () => { throw new Error("blob down"); });
    await expect(forgetPersonInEpisodes("Ann", { sql: sql as never, del })).rejects.toThrow("blob down");
    expect(sql).toHaveBeenCalledTimes(3);
  });
  it("ignores a blank name", async () => {
    const sql = vi.fn();
    expect(await forgetPersonInEpisodes("  ", { sql: sql as never, del: vi.fn() })).toEqual({ episodeIds: [], audioDeleted: 0 });
    expect(sql).not.toHaveBeenCalled();
  });
});

describe("forgetPersonInGardenerRuns", () => {
  const runs = [
    { id: "1", output_md: "## Pitch\nAnn's ramen tip." },
    { id: "2", output_md: "Nobody named here, only Annabel." },
    { id: "3", output_md: "ann again" },
  ];
  it("deletes drafts that name the person (whole word, any case) and keeps the rest", async () => {
    const sql = vi.fn().mockResolvedValueOnce(runs).mockResolvedValue([]);
    expect(await forgetPersonInGardenerRuns("Ann", { sql: sql as never })).toEqual({ runIds: [1, 3] });
    expect(sql).toHaveBeenCalledTimes(3); // one select, two deletes
  });
  it("ignores a blank name", async () => {
    const sql = vi.fn();
    expect(await forgetPersonInGardenerRuns(" ", { sql: sql as never })).toEqual({ runIds: [] });
    expect(sql).not.toHaveBeenCalled();
  });
});
