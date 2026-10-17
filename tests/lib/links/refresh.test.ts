import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeMockDb } from "../../helpers/mock-db";

const h = vi.hoisted(() => ({ mock: undefined as unknown as ReturnType<typeof import("../../helpers/mock-db").makeMockDb> }));
vi.mock("../../../agent/lib/db", () => ({ db: () => h.mock.sql }));
vi.mock("../../../agent/lib/links/candidates", () => ({
  ensureRecEmbeddings: vi.fn(async () => 0),
  ideaPairCandidates: vi.fn(async () => []),
  recIdeaCandidates: vi.fn(async () => []),
}));

import { ensureRecEmbeddings, ideaPairCandidates, recIdeaCandidates } from "../../../agent/lib/links/candidates";
import { MAX_CALLS_PER_ITEM, MAX_CALLS_PER_RUN, refreshLinks } from "../../../agent/lib/links/refresh";

const idea = (id: number) => ({ id, title: `Idea ${id}`, summary: null, notes: [] });
const pair = (a: number, b: number) => ({ a: idea(a), b: idea(b) });
const fit = (recId: number, ideaId: number) => ({
  rec: { id: recId, type: "album", name: `Rec ${recId}`, creator: null, contextSummary: null },
  idea: idea(ideaId),
});

const inserts = () => h.mock.calls.filter((c) => c.text.includes("insert into links"));

describe("refreshLinks", () => {
  beforeEach(() => {
    h.mock = makeMockDb();
    vi.mocked(ideaPairCandidates).mockResolvedValue([]);
    vi.mocked(recIdeaCandidates).mockResolvedValue([]);
    vi.mocked(ensureRecEmbeddings).mockResolvedValue(0);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("writes related + merge_suggestion for a pair and fits for a rec, with Jev's probabilities, never overwriting Tarik's status", async () => {
    vi.mocked(ideaPairCandidates).mockResolvedValue([pair(1, 2)]);
    vi.mocked(recIdeaCandidates).mockResolvedValue([fit(9, 1)]);
    const ask = vi.fn().mockResolvedValueOnce({ related: 0.82, same_idea: 0.4 }).mockResolvedValueOnce({ fits: 0.3 });
    const out = await refreshLinks({ ask: ask as never });
    expect(out).toMatchObject({ calls: 2, ideaPairs: 1, recPairs: 1, failed: 0 });
    const ins = inserts();
    expect(ins).toHaveLength(2);
    // re-judging a changed pair refreshes the probability, but only while the link is still a suggestion
    for (const c of ins) {
      expect(c.text).toMatch(/on conflict \(from_type, from_id, to_type, to_id, kind\) do update/);
      expect(c.text).toMatch(/where links\.status = 'suggested'/);
    }
    expect(ins[0].values).toEqual(["1", "2", 0.82, "1", "2", 0.4]);
    expect(ins[1].values).toEqual(["9", "1", 0.3]);
  });

  it(`stops at the per-run cap (${MAX_CALLS_PER_RUN} model calls) and asks for no more candidates than it can judge`, async () => {
    const many = Array.from({ length: MAX_CALLS_PER_RUN + 10 }, (_, i) => pair(100 + 2 * i, 101 + 2 * i));
    vi.mocked(ideaPairCandidates).mockResolvedValue(many);
    const ask = vi.fn(async () => ({ related: 0.5, same_idea: 0.1 }));
    const out = await refreshLinks({ ask: ask as never });
    expect(ask).toHaveBeenCalledTimes(MAX_CALLS_PER_RUN);
    expect(out.calls).toBe(MAX_CALLS_PER_RUN);
    expect(vi.mocked(ideaPairCandidates).mock.calls[0][0]).toBe(MAX_CALLS_PER_RUN);
    expect(recIdeaCandidates).not.toHaveBeenCalled(); // budget spent
    expect(ensureRecEmbeddings).not.toHaveBeenCalled(); // embedding a batch is a model call too
  });

  it(`asks about any one item at most ${MAX_CALLS_PER_ITEM} times per run`, async () => {
    const hub = Array.from({ length: MAX_CALLS_PER_ITEM + 3 }, (_, i) => pair(1, 10 + i));
    vi.mocked(ideaPairCandidates).mockResolvedValue(hub);
    vi.mocked(recIdeaCandidates).mockResolvedValue([fit(7, 1), fit(8, 2)]);
    const ask = vi.fn(async (state: Record<string, string>) => ("rec" in state ? { fits: 0.9 } : { related: 0.5, same_idea: 0.1 }));
    const out = await refreshLinks({ ask: ask as never });
    expect(out.ideaPairs).toBe(MAX_CALLS_PER_ITEM);
    expect(out.recPairs).toBe(1); // rec 7 → idea 1 is skipped (idea 1 is spent); rec 8 → idea 2 is judged
    expect(out.skipped).toBe(3 + 1);
    expect(ask).not.toHaveBeenCalledWith({ rec: "album: Rec 7", idea: "Idea 1" }, expect.anything());
  });

  it("keeps going when one call fails, logging ids and the error name only", async () => {
    vi.mocked(ideaPairCandidates).mockResolvedValue([pair(1, 2), pair(3, 4)]);
    const secret = "a transcript sentence that must never reach the logs";
    const ask = vi.fn().mockRejectedValueOnce(Object.assign(new Error(secret), { name: "APICallError" })).mockResolvedValueOnce({ related: 0.9, same_idea: 0.9 });
    const out = await refreshLinks({ ask: ask as never });
    expect(out).toMatchObject({ calls: 2, ideaPairs: 1, failed: 1 });
    const logged = [...vi.mocked(console.error).mock.calls, ...vi.mocked(console.log).mock.calls].flat().map(String).join("\n");
    expect(logged).toContain("APICallError");
    expect(logged).toContain("a=1");
    expect(logged).not.toContain(secret);
  });

  it("stops the run after three failures in a row (the gateway is down: do not burn the budget)", async () => {
    vi.mocked(ideaPairCandidates).mockResolvedValue([pair(1, 2), pair(3, 4), pair(5, 6), pair(7, 8)]);
    const ask = vi.fn(async () => { throw new Error("down"); });
    const out = await refreshLinks({ ask: ask as never });
    expect(ask).toHaveBeenCalledTimes(3);
    expect(out).toMatchObject({ calls: 3, failed: 3, ideaPairs: 0 });
    expect(ensureRecEmbeddings).not.toHaveBeenCalled();
  });

  it("embeds new recs last, as one call within the budget, so the next run can judge them", async () => {
    vi.mocked(ensureRecEmbeddings).mockResolvedValue(12);
    const out = await refreshLinks({ ask: vi.fn() as never });
    expect(out).toMatchObject({ calls: 1, embedded: 12 });
    vi.mocked(ensureRecEmbeddings).mockResolvedValue(0);
    expect((await refreshLinks({ ask: vi.fn() as never })).calls).toBe(0);
  });

  it("logs one summary line with the call count", async () => {
    vi.mocked(ideaPairCandidates).mockResolvedValue([pair(1, 2)]);
    await refreshLinks({ ask: vi.fn(async () => ({ related: 0.1, same_idea: 0.1 })) as never });
    expect(vi.mocked(console.log).mock.calls.flat().join(" ")).toMatch(/\[links\] run calls=1 /);
  });
});
