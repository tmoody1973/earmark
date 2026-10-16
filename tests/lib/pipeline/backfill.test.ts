import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../agent/lib/pipeline/process-conversation", async (orig) => ({
  ...(await orig<typeof import("../../../agent/lib/pipeline/process-conversation")>()),
  processConversation: vi.fn(async () => ({ skipped: false, ideas: 1, recs: 0, reviews: 0, failed: 0, incomplete: false, saved: { recIds: [], ideaClusterIds: [], mentionIds: [], bloomedClusterIds: [] } })),
}));
vi.mock("../../../agent/lib/pipeline/process-journal", () => ({ processJournal: vi.fn(async () => ({ created: "rec" })) }));
vi.mock("../../../agent/lib/store/conversations", () => ({ pruneUtteranceBuffer: vi.fn(async () => {}) }));

import { processConversation } from "../../../agent/lib/pipeline/process-conversation";
import { processJournal } from "../../../agent/lib/pipeline/process-journal";
import { runBackfill } from "../../../agent/lib/pipeline/backfill";
import { pruneUtteranceBuffer } from "../../../agent/lib/store/conversations";
import type { BeeClient } from "../../../agent/lib/bee/client";

const NOW = new Date("2026-10-16T12:00:00Z").getTime();
const h = (hoursAgo: number) => NOW - hoursAgo * 3_600_000;
const deps = (bee: BeeClient) => ({ bee, now: () => new Date(NOW) });

function fakeBee(): BeeClient {
  const convPages = [
    { conversations: [{ id: 1, start_time: h(1), state: "COMPLETED" }, { id: 2, start_time: h(2), state: "CAPTURING" }], next_cursor: "p2" },
    { conversations: [{ id: 3, start_time: h(30), state: "COMPLETED" }, { id: 4, start_time: h(60), state: "COMPLETED" }], next_cursor: "p3" },
    { conversations: [{ id: 5, start_time: h(70), state: "COMPLETED" }], next_cursor: null },
  ];
  const journalPages = [
    { journals: [
      { id: "a", text: "Earmark that, Kopp's", state: "READY", created_at: h(3) },
      { id: "b", text: null, state: "READY", created_at: h(4) },
      { id: "c", text: "Earmark this", state: "PREPARING", created_at: h(5) },
      { id: "d", text: "old", state: "READY", created_at: h(80) },
    ], next_cursor: null },
  ];
  return {
    listConversations: vi.fn(async ({ cursor }: { cursor?: string } = {}) => convPages[cursor === "p2" ? 1 : cursor === "p3" ? 2 : 0]),
    listJournals: vi.fn(async () => journalPages[0]),
  } as unknown as BeeClient;
}

beforeEach(() => vi.clearAllMocks());

describe("runBackfill", () => {
  it("processes completed conversations and finished journals from the last 48 hours", async () => {
    const r = await runBackfill({ deps: deps(fakeBee()) });
    expect(vi.mocked(processConversation).mock.calls.map((c) => c[0])).toEqual([1, 3]);
    expect(vi.mocked(processJournal).mock.calls.map((c) => c[0].id)).toEqual(["a"]);
    expect(r).toEqual({ conversations: 2, journals: 1, failed: 0, incomplete: 0, stoppedEarly: false });
  });

  it("prunes the utterance buffer at the end of every run", async () => {
    await runBackfill({ deps: deps(fakeBee()) });
    expect(pruneUtteranceBuffer).toHaveBeenCalledTimes(1);
  });

  it("a failed prune is logged by name and does not fail the run", async () => {
    vi.mocked(pruneUtteranceBuffer).mockRejectedValueOnce(new RangeError("secret"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await runBackfill({ deps: deps(fakeBee()) });
    expect(r.conversations).toBe(2);
    const logged = JSON.stringify(err.mock.calls);
    expect(logged).toContain("[backfill] prune failed error=RangeError");
    expect(logged).not.toContain("secret");
    err.mockRestore();
  });

  it("stops paging once a page reaches past the cutoff", async () => {
    const bee = fakeBee();
    await runBackfill({ deps: deps(bee) });
    expect(bee.listConversations).toHaveBeenCalledTimes(2);
  });

  it("honors a custom hours window", async () => {
    await runBackfill({ hours: 72, deps: deps(fakeBee()) });
    expect(vi.mocked(processConversation).mock.calls.map((c) => c[0])).toEqual([1, 3, 4, 5]);
  });

  it("caps paging at 20 pages even if the cursor never ends", async () => {
    const bee = {
      listConversations: vi.fn(async () => ({ conversations: [{ id: 1, start_time: h(1), state: "COMPLETED" }], next_cursor: "again" })),
      listJournals: vi.fn(async () => ({ journals: [{ id: "x", text: "t", state: "READY", created_at: h(1) }], next_cursor: "again" })),
    } as unknown as BeeClient;
    await runBackfill({ deps: deps(bee) });
    expect(bee.listConversations).toHaveBeenCalledTimes(20);
    expect(bee.listJournals).toHaveBeenCalledTimes(20);
  });

  it("counts a compost outage as a failed item (retried next run) and keeps going", async () => {
    const { CompostUnavailableError } = await import("../../../agent/lib/ideas/compost");
    vi.mocked(processConversation).mockRejectedValueOnce(new CompostUnavailableError(2));
    vi.mocked(processJournal).mockRejectedValueOnce(new CompostUnavailableError(1));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await runBackfill({ deps: deps(fakeBee()) });
    expect(r).toEqual({ conversations: 1, journals: 0, failed: 2, incomplete: 0, stoppedEarly: false });
    expect(JSON.stringify(err.mock.calls)).toContain("CompostUnavailableError");
    err.mockRestore();
  });

  it("keeps going when one conversation or journal fails, logging only id and error name", async () => {
    vi.mocked(processConversation).mockRejectedValueOnce(new TypeError("secret transcript words"));
    vi.mocked(processJournal).mockRejectedValueOnce(new Error("boom secret"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await runBackfill({ deps: deps(fakeBee()) });
    expect(r).toEqual({ conversations: 1, journals: 0, failed: 2, incomplete: 0, stoppedEarly: false });
    const logged = JSON.stringify(err.mock.calls);
    expect(logged).toContain("TypeError");
    expect(logged).not.toContain("secret");
    err.mockRestore();
  });

  it("stops claiming new conversations once 70% of the time budget is spent, and says so", async () => {
    let clock = NOW;
    vi.mocked(processConversation).mockImplementation(async () => {
      clock += 800; // each conversation takes 0.8 s of a 1 s budget
      return { skipped: false, ideas: 1, recs: 0, reviews: 0, failed: 0, incomplete: false, saved: { recIds: [], ideaClusterIds: [], mentionIds: [], bloomedClusterIds: [] } };
    });
    const r = await runBackfill({ budgetMs: 1000, deps: { bee: fakeBee(), now: () => new Date(clock) } });
    expect(vi.mocked(processConversation).mock.calls.map((c) => c[0])).toEqual([1]); // 3 would start at 0.8 s ≥ 0.7 s
    expect(r).toEqual({ conversations: 1, journals: 1, failed: 0, incomplete: 0, stoppedEarly: true });
  });

  it("passes each conversation a deadline of start + 90% of the budget and counts incomplete ones", async () => {
    vi.mocked(processConversation).mockImplementation(async (id) => ({
      skipped: false, ideas: 0, recs: 0, reviews: 0, failed: 0, incomplete: id === 1, saved: { recIds: [], ideaClusterIds: [], mentionIds: [], bloomedClusterIds: [] },
    }));
    const r = await runBackfill({ budgetMs: 1000, deps: { bee: fakeBee(), now: () => new Date(NOW) } });
    for (const call of vi.mocked(processConversation).mock.calls) expect(call[1]).toMatchObject({ deadline: NOW + 900 });
    expect(r.incomplete).toBe(1);
    expect(r.conversations).toBe(1); // the incomplete one is not counted as processed
  });

  it("voice notes go first, so a long conversation cannot starve them", async () => {
    const order: string[] = [];
    vi.mocked(processConversation).mockImplementation(async (id) => {
      order.push(`c${id}`);
      return { skipped: false, ideas: 0, recs: 0, reviews: 0, failed: 0, incomplete: false, saved: { recIds: [], ideaClusterIds: [], mentionIds: [], bloomedClusterIds: [] } };
    });
    vi.mocked(processJournal).mockImplementation(async (j) => {
      order.push(`j${j.id}`);
      return { created: null, saved: { recIds: [], ideaClusterIds: [], mentionIds: [], bloomedClusterIds: [] } };
    });
    await runBackfill({ deps: deps(fakeBee()) });
    expect(order).toEqual(["ja", "c1", "c3"]);
  });

  it("does not count conversations that were already processed", async () => {
    vi.mocked(processConversation).mockResolvedValue({ skipped: true, ideas: 0, recs: 0, reviews: 0, failed: 0, incomplete: false, saved: { recIds: [], ideaClusterIds: [], mentionIds: [], bloomedClusterIds: [] } });
    const r = await runBackfill({ deps: deps(fakeBee()) });
    expect(r.conversations).toBe(0);
  });
});
