import { describe, expect, it, vi } from "vitest";
import { forgetPersonInEpisodes, forgetPersonInFactProposals, forgetPersonInGardenerRuns } from "../../agent/lib/privacy/forget-m5";

const rows = [
  { id: "1", script_md: "Title\n\nAnn suggested a ramen spot.", audio_url: "https://blob.test/1.mp3" },
  { id: "2", script_md: "Title\n\nNobody here, just Joanna and Annabel.", audio_url: "https://blob.test/2.mp3" },
  { id: "3", script_md: "Title\n\nNo audio yet, but ann is named.", audio_url: null },
];

describe("forgetPersonInEpisodes", () => {
  it("deletes Blob audio and rows only for episodes naming the person (whole word, any case)", async () => {
    const sql = vi.fn().mockResolvedValueOnce(rows).mockResolvedValue([]);
    const del = vi.fn(async () => {});
    const out = await forgetPersonInEpisodes("Ann", { sql: sql as never, del });
    expect(out).toEqual({ episodesDeleted: 2 });
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith("https://blob.test/1.mp3");
    expect(sql).toHaveBeenCalledTimes(3); // one select, two deletes
  });
  it("keeps the row when the Blob delete fails, so the forget can be retried", async () => {
    const sql = vi.fn().mockResolvedValueOnce(rows);
    const del = vi.fn(async () => { throw new Error("blob down"); });
    await expect(forgetPersonInEpisodes("Ann", { sql: sql as never, del })).rejects.toThrow();
    expect(sql).toHaveBeenCalledTimes(1);
  });
  it("ignores a blank name", async () => {
    const sql = vi.fn();
    expect(await forgetPersonInEpisodes("  ", { sql: sql as never, del: vi.fn() })).toEqual({ episodesDeleted: 0 });
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
    expect(await forgetPersonInGardenerRuns("Ann", { sql: sql as never })).toEqual({ runsDeleted: 2 });
    expect(sql).toHaveBeenCalledTimes(3); // one select, two deletes
  });
  it("ignores a blank name", async () => {
    const sql = vi.fn();
    expect(await forgetPersonInGardenerRuns(" ", { sql: sql as never })).toEqual({ runsDeleted: 0 });
    expect(sql).not.toHaveBeenCalled();
  });
});

describe("forgetPersonInFactProposals", () => {
  const props = [
    { id: "1", text: "Developing an idea: Ann's podcast (mentioned 3 times since Sep)", bee_fact_id: "77" },
    { id: "2", text: "Loves spiritual jazz", bee_fact_id: "78" },
    { id: "3", text: "Enjoys what ann recommends", bee_fact_id: null },
  ];
  it("deletes proposals naming the person and returns their Bee fact ids for the caller to delete in Bee", async () => {
    const sql = vi.fn().mockResolvedValueOnce(props).mockResolvedValue([]);
    const out = await forgetPersonInFactProposals("Ann", { sql: sql as never });
    expect(out).toEqual({ proposalsDeleted: 2, beeFactIds: [77] });
    expect(sql).toHaveBeenCalledTimes(1 + 2 * 2); // select, then per proposal: sync row + proposal row
  });
  it("ignores a blank name", async () => {
    const sql = vi.fn();
    expect(await forgetPersonInFactProposals(" ", { sql: sql as never })).toEqual({ proposalsDeleted: 0, beeFactIds: [] });
    expect(sql).not.toHaveBeenCalled();
  });
});
