import { beforeEach, describe, expect, it, vi } from "vitest";

const sql = vi.fn();
vi.mock("../../../agent/lib/db", () => ({ db: () => sql }));
import { runDueGardeners, runGardener, type GardenerRow } from "../../../agent/lib/gardeners/run";
import { decideRun } from "../../../agent/lib/gardeners/decide";

const custom: GardenerRow = {
  id: 2, name: "Friday pitches", kind: "custom", task: "Turn my ready ideas into Intersection pitches.",
  schedule: { every: "week", weekday: 5, hourUtc: 14 }, sources: ["ideas"], needs_approval: true, last_run_at: null,
};
const gen = (text: string) => vi.fn(async (opts: { prompt: string }) => ({ text, prompt: opts.prompt }));

beforeEach(() => { sql.mockReset(); vi.restoreAllMocks(); process.env.EARMARK_OWNER_FIRST_NAME = "Tarik"; });

describe("runGardener (custom)", () => {
  it("gives the model only the scoped sources and saves a draft", async () => {
    sql.mockResolvedValueOnce([{ title: "AI in public radio", stage: "ready", mention_count: 4 }]) // ideas
      .mockResolvedValueOnce([{ id: "31" }]) // insert run
      .mockResolvedValueOnce([]); // last_run_at
    const generateImpl = gen("## Pitch\nAI in public radio, in short.");
    expect(await runGardener(custom, { generateImpl: generateImpl as never })).toBe(31);
    const prompt = generateImpl.mock.calls[0][0].prompt;
    expect(prompt).toContain("AI in public radio");
    expect(prompt).not.toContain("recommenders");
    expect(sql).toHaveBeenCalledTimes(3);
    expect(sql.mock.calls[1].slice(1)).toContain("draft");
  });

  it("never sends the owner's name to the model as a recommender", async () => {
    sql.mockResolvedValueOnce([{ canonical_name: "Ramen", first_name: "Tarik" }, { canonical_name: "Tacos", first_name: "Ann" }])
      .mockResolvedValueOnce([{ id: "5" }]).mockResolvedValueOnce([]);
    const generateImpl = gen("Tacos from Ann.");
    await runGardener({ ...custom, sources: ["recs"] }, { generateImpl: generateImpl as never });
    expect(generateImpl.mock.calls[0][0].prompt).toContain("Ann");
    expect(generateImpl.mock.calls[0][0].prompt).not.toContain("Tarik");
  });

  it("retries once on a guard issue, then fails closed with nothing saved or logged", async () => {
    sql.mockResolvedValueOnce([{ title: "Idea", stage: "ready", mention_count: 1 }]);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const generateImpl = gen("Tarik should pitch this."); // names the owner on both attempts
    await expect(runGardener(custom, { generateImpl: generateImpl as never })).rejects.toThrow(/rejected/);
    expect(generateImpl).toHaveBeenCalledTimes(2);
    expect(sql).toHaveBeenCalledTimes(1); // only the source read; no insert
    expect(JSON.stringify(err.mock.calls)).not.toContain("Tarik");
  });

  it("auto-approved custom drafts are saved as approved", async () => {
    sql.mockResolvedValueOnce([{ title: "Idea", stage: "ready", mention_count: 1 }]).mockResolvedValueOnce([{ id: "9" }]).mockResolvedValueOnce([]);
    await runGardener({ ...custom, needs_approval: false }, { generateImpl: gen("ok") as never });
    expect(sql.mock.calls[1].slice(1)).toContain("approved");
  });
});

describe("runGardener (episode)", () => {
  it("delegates to runEpisode and links episode_id, leaving it unpublished", async () => {
    sql.mockResolvedValueOnce([{ id: "32" }]).mockResolvedValueOnce([]);
    const episode = vi.fn(async () => ({ episodeId: 8, title: "Week of Oct 18" }));
    expect(await runGardener({ ...custom, kind: "episode" }, { episode })).toBe(32);
    expect(episode).toHaveBeenCalledTimes(1);
    expect(sql.mock.calls[0].slice(1)).toContain(8);
    expect(sql).toHaveBeenCalledTimes(2); // insert + last_run_at; no published_at update
  });
});

describe("runDueGardeners", () => {
  it("keeps going when one gardener fails, logging only ids and error names", async () => {
    sql.mockResolvedValueOnce([custom, { ...custom, id: 3, name: "Secret name", task: "Secret task text here" }]);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const run = vi.fn().mockRejectedValueOnce(new TypeError("boom with Secret task text")).mockResolvedValueOnce(40);
    const out = await runDueGardeners(new Date("2026-10-23T15:00:00Z"), { run });
    expect(out).toEqual({ ran: 1, failed: 1 });
    const logged = JSON.stringify(err.mock.calls);
    expect(logged).toContain("TypeError");
    expect(logged).not.toContain("Secret");
    expect(logged).not.toContain("boom");
  });
  it("skips gardeners that are not due", async () => {
    sql.mockResolvedValueOnce([custom]);
    const run = vi.fn();
    expect(await runDueGardeners(new Date("2026-10-22T15:00:00Z"), { run })).toEqual({ ran: 0, failed: 0 });
    expect(run).not.toHaveBeenCalled();
  });
});

describe("decideRun", () => {
  it("approving publishes the linked episode", async () => {
    sql.mockResolvedValueOnce([{ episode_id: "8" }]).mockResolvedValueOnce([]);
    await decideRun(1, "approved");
    expect(sql).toHaveBeenCalledTimes(2);
  });
  it("dismissing never touches the episode, and a non-draft run is a no-op", async () => {
    sql.mockResolvedValueOnce([{ episode_id: "8" }]);
    await decideRun(1, "dismissed");
    expect(sql).toHaveBeenCalledTimes(1);
    sql.mockReset(); sql.mockResolvedValueOnce([]);
    await decideRun(1, "approved");
    expect(sql).toHaveBeenCalledTimes(1);
  });
});
