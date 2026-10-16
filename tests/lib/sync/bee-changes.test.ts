import { beforeEach, describe, expect, it, vi } from "vitest";

const cursors = vi.hoisted(() => ({
  getCursor: vi.fn(), saveCursor: vi.fn(async () => {}),
  getPending: vi.fn(), savePending: vi.fn(async (_p: unknown) => {}),
}));
vi.mock("../../../agent/lib/store/sync-cursors", () => cursors);

import { BEE_CHANGES_CURSOR, normalizeChanges, runBeeChangesSync } from "../../../agent/lib/sync/bee-changes";
import type { BeeChanges } from "../../../agent/lib/bee/client";
import { CompostUnavailableError } from "../../../agent/lib/ideas/compost";
import { SystemicTriageError } from "../../../agent/lib/pipeline/triage";

const meta = { next_cursor: "v1-200", since: 100, until: 200, updated: true, timezone: "America/Chicago" };
const changes = (over: Partial<BeeChanges> = {}): BeeChanges =>
  ({ ...meta, facts: [], todos: [], dailies: [], conversations: [], journals: [], ...over }) as BeeChanges;

const convResult = { skipped: false, ideas: 0, recs: 1, reviews: 0, failed: 0, incomplete: false, saved: {} };

function deps(feed: BeeChanges) {
  return {
    bee: {
      changes: vi.fn(async (_cursor?: string) => feed),
      getJournal: vi.fn(async (id: string) => ({ id, text: "Earmark that, Ann's ramen spot" as string | null, state: "READY", created_at: 1760610000000 as number | string })),
    },
    processConversation: vi.fn(async (_id: number, _o?: unknown) => ({ ...convResult }) as never),
    processJournal: vi.fn(async () => ({ created: "rec" as const, saved: {} }) as never),
    handleTodoChange: vi.fn(async (_id: number) => {}),
    handleFactChange: vi.fn(async (_id: number) => {}),
    now: vi.fn(() => new Date(1_000_000)),
    budgetMs: 240_000,
  };
}

let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  cursors.getCursor.mockResolvedValue("v1-100");
  cursors.getPending.mockResolvedValue({ conversations: [], journals: [] });
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("normalizeChanges", () => {
  it("accepts ids or {id} objects, types them per list and dedupes", () => {
    expect(normalizeChanges(changes({ conversations: [{ id: 5 }, 5, "6"], journals: [55, { id: "55" }], todos: [{ id: 10 }], facts: ["7"] }))).toEqual({
      conversations: [5, 6], journals: ["55"], todos: [10], facts: [7], nextCursor: "v1-200",
    });
  });
});

describe("runBeeChangesSync", () => {
  it("routes every changed id to its handler, then saves the next cursor", async () => {
    const d = deps(changes({ conversations: [123], journals: ["55"], todos: [10], facts: [7] }));
    const r = await runBeeChangesSync(d as never);
    expect(d.bee.changes).toHaveBeenCalledWith("v1-100");
    expect(d.processConversation).toHaveBeenCalledWith(123, expect.objectContaining({ deadline: expect.any(Number) }));
    expect(d.bee.getJournal).toHaveBeenCalledWith("55");
    expect(d.processJournal).toHaveBeenCalledWith({ id: "55", text: "Earmark that, Ann's ramen spot", createdAt: new Date(1760610000000) });
    expect(d.handleTodoChange).toHaveBeenCalledWith(10);
    expect(d.handleFactChange).toHaveBeenCalledWith(7);
    expect(cursors.saveCursor).toHaveBeenCalledWith(BEE_CHANGES_CURSOR, "v1-200");
    expect(r).toEqual({ conversations: 1, journals: 1, todos: 1, facts: 1, failed: 0, gone: 0, pending: 0, cursorSaved: true });
  });

  it("counts only conversations actually processed, not skipped (deduped or still capturing)", async () => {
    const d = deps(changes({ conversations: [1] }));
    d.processConversation.mockResolvedValueOnce({ ...convResult, skipped: true } as never);
    expect((await runBeeChangesSync(d as never)).conversations).toBe(0);
  });

  it("bootstraps without a cursor on the first run", async () => {
    cursors.getCursor.mockResolvedValue(null);
    const d = deps(changes());
    await runBeeChangesSync(d as never);
    expect(d.bee.changes).toHaveBeenCalledWith(undefined);
  });

  it("a normal single-item failure does not block the cursor; the other items still run", async () => {
    const d = deps(changes({ conversations: [1, 2], journals: ["9"] }));
    d.processConversation.mockRejectedValueOnce(new Error("boom with transcript text"));
    const r = await runBeeChangesSync(d as never);
    expect(d.processConversation).toHaveBeenCalledTimes(2);
    expect(d.processJournal).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ failed: 1, cursorSaved: true });
    expect(cursors.saveCursor).toHaveBeenCalledWith(BEE_CHANGES_CURSOR, "v1-200");
    const logged = errSpy.mock.calls.flat().join(" ");
    expect(logged).toContain("id=1");
    expect(logged).toContain("Error");
    expect(logged).not.toContain("transcript text");
  });

  it("CompostUnavailableError (claim released) also leaves the cursor free to advance", async () => {
    const d = deps(changes({ journals: ["9"] }));
    d.processJournal.mockRejectedValueOnce(new CompostUnavailableError(2));
    const r = await runBeeChangesSync(d as never);
    expect(r).toMatchObject({ failed: 1, cursorSaved: true });
  });

  it("a systemic triage error stops the run and does not save the cursor", async () => {
    const d = deps(changes({ conversations: [1, 2] }));
    d.processConversation.mockRejectedValueOnce(new SystemicTriageError("all_failed"));
    await expect(runBeeChangesSync(d as never)).rejects.toBeInstanceOf(SystemicTriageError);
    expect(d.processConversation).toHaveBeenCalledTimes(1);
    expect(cursors.saveCursor).not.toHaveBeenCalled();
  });

  it("a failing todo/fact handler (thrown out of the loop) does not save the cursor", async () => {
    const d = deps(changes({ conversations: [123], todos: [10] }));
    d.handleTodoChange.mockRejectedValueOnce(new Error("bee 500"));
    await expect(runBeeChangesSync(d as never)).rejects.toThrow("bee 500");
    expect(cursors.saveCursor).not.toHaveBeenCalled();
  });

  it("does not save the cursor when the feed fetch fails", async () => {
    const d = deps(changes());
    d.bee.changes.mockRejectedValueOnce(new Error("bee 503"));
    await expect(runBeeChangesSync(d as never)).rejects.toThrow("bee 503");
    expect(cursors.saveCursor).not.toHaveBeenCalled();
  });

  it("does not save the cursor when the feed fails schema validation", async () => {
    const d = deps(changes());
    d.bee.changes.mockRejectedValueOnce(Object.assign(new Error("invalid"), { name: "ZodError" }));
    await expect(runBeeChangesSync(d as never)).rejects.toThrow("invalid");
    expect(cursors.saveCursor).not.toHaveBeenCalled();
  });

  it("skips a conversation or journal Bee no longer has (404) and still advances", async () => {
    const d = deps(changes({ conversations: [404], journals: ["gone"] }));
    d.processConversation.mockRejectedValueOnce(Object.assign(new Error("not found"), { status: 404 }));
    d.bee.getJournal.mockRejectedValueOnce(Object.assign(new Error("not found"), { status: 404 }));
    const r = await runBeeChangesSync(d as never);
    expect(r).toMatchObject({ failed: 0, gone: 2, cursorSaved: true });
    const logged = errSpy.mock.calls.flat().join(" ");
    expect(logged).toContain("conversation gone id=404");
    expect(logged).toContain("journal gone id=gone");
  });

  it("leaves a journal that is still transcribing for a later run", async () => {
    const d = deps(changes({ journals: ["56"] }));
    d.bee.getJournal.mockResolvedValueOnce({ id: "56", text: null, state: "ANALYZING", created_at: 1 });
    const r = await runBeeChangesSync(d as never);
    expect(d.processJournal).not.toHaveBeenCalled();
    expect(r.cursorSaved).toBe(true);
    expect(r.pending).toBe(1); // retried next run from the pending list
  });

  it("an incomplete conversation (its deadline hit) means the cursor is not saved", async () => {
    const d = deps(changes({ conversations: [1] }));
    d.processConversation.mockResolvedValueOnce({ ...convResult, incomplete: true } as never);
    const r = await runBeeChangesSync(d as never);
    expect(r.cursorSaved).toBe(false);
    expect(cursors.saveCursor).not.toHaveBeenCalled();
  });

  it("stops claiming new items past 70% of the budget and does not save the cursor", async () => {
    const d = deps(changes({ conversations: [1, 2, 3] }));
    let t = 1_000_000;
    d.now.mockImplementation(() => new Date(t));
    d.processConversation.mockImplementation(async () => { t += 200_000; return { ...convResult } as never; });
    const r = await runBeeChangesSync(d as never);
    expect(d.processConversation).toHaveBeenCalledTimes(1);
    expect(r.cursorSaved).toBe(false);
    expect(cursors.saveCursor).not.toHaveBeenCalled();
  });

  it("a getJournal error that is not a 404 counts as failed and the cursor still advances", async () => {
    const d = deps(changes({ journals: ["9"] }));
    d.bee.getJournal.mockRejectedValueOnce(new Error("bee 500"));
    const r = await runBeeChangesSync(d as never);
    expect(r).toMatchObject({ failed: 1, cursorSaved: true });
    expect(d.processJournal).not.toHaveBeenCalled();
  });

  it("stops the journal loop past 70% of the budget and does not save the cursor", async () => {
    const d = deps(changes({ journals: ["1", "2", "3"] }));
    let t = 1_000_000;
    d.now.mockImplementation(() => new Date(t));
    d.processJournal.mockImplementation(async () => { t += 200_000; return { created: "rec", saved: {} } as never; });
    const r = await runBeeChangesSync(d as never);
    expect(d.processJournal).toHaveBeenCalledTimes(1);
    expect(r.cursorSaved).toBe(false);
    expect(cursors.saveCursor).not.toHaveBeenCalled();
  });
});

describe("normalizeChanges dropped ids", () => {
  it("logs the kind and count of ids that are not integers, without throwing or logging the values", () => {
    const n = normalizeChanges(changes({ conversations: [5, "oops", { id: "nope" }] }));
    expect(n.conversations).toEqual([5]);
    const logged = errSpy.mock.calls.flat().join(" ");
    expect(logged).toContain("dropped");
    expect(logged).toContain("conversations");
    expect(logged).toContain("count=2");
    expect(logged).not.toContain("oops");
  });
});

describe("pending list", () => {
  const NOW = 1_000_000;
  const hours = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
  const saved = () => cursors.savePending.mock.calls.at(-1)![0];

  it("a conversation skipped as still capturing is stored as pending, and the cursor still advances", async () => {
    const d = deps(changes({ conversations: [7] }));
    d.processConversation.mockResolvedValueOnce({ ...convResult, skipped: true, reason: "capturing" } as never);
    const r = await runBeeChangesSync(d as never);
    expect(saved()).toEqual({ conversations: [{ id: 7, firstSeen: new Date(NOW).toISOString() }], journals: [] });
    expect(r).toMatchObject({ pending: 1, cursorSaved: true, conversations: 0 });
  });

  it("the next run retries pending first (even when the feed no longer lists it), then drops it once processed", async () => {
    cursors.getPending.mockResolvedValue({ conversations: [{ id: 7, firstSeen: hours(1) }], journals: [{ id: "j1", firstSeen: hours(1) }] });
    const d = deps(changes());
    const order: string[] = [];
    d.processConversation.mockImplementation(async (id: number) => { order.push(`pc${id}`); return { ...convResult } as never; });
    d.bee.changes.mockImplementation(async () => { order.push("feed"); return changes(); });
    const r = await runBeeChangesSync(d as never);
    expect(order).toEqual(["pc7", "feed"]);
    expect(d.bee.getJournal).toHaveBeenCalledWith("j1");
    expect(d.processJournal).toHaveBeenCalledTimes(1);
    expect(saved()).toEqual({ conversations: [], journals: [] });
    expect(r).toMatchObject({ conversations: 1, journals: 1, pending: 0 });
  });

  it("an item still capturing stays pending with its ORIGINAL firstSeen", async () => {
    const first = hours(2);
    cursors.getPending.mockResolvedValue({ conversations: [{ id: 7, firstSeen: first }], journals: [] });
    const d = deps(changes({ conversations: [7] }));
    d.processConversation.mockResolvedValue({ ...convResult, skipped: true, reason: "capturing" } as never);
    await runBeeChangesSync(d as never);
    expect(d.processConversation).toHaveBeenCalledTimes(1); // listed in both pending and feed: tried once
    expect(cursors.savePending).not.toHaveBeenCalled(); // unchanged: same id, same firstSeen
  });

  it("drops an item older than 48 h without trying it, and logs the expiry with its id", async () => {
    cursors.getPending.mockResolvedValue({ conversations: [{ id: 8, firstSeen: hours(49) }], journals: [{ id: "old", firstSeen: hours(72) }] });
    const d = deps(changes());
    await runBeeChangesSync(d as never);
    expect(d.processConversation).not.toHaveBeenCalled();
    expect(d.bee.getJournal).not.toHaveBeenCalled();
    expect(saved()).toEqual({ conversations: [], journals: [] });
    const logged = errSpy.mock.calls.flat().join(" ");
    expect(logged).toContain("expired id=8");
    expect(logged).toContain("expired id=old");
  });

  it("a pending item that 404s is removed and counted as gone", async () => {
    cursors.getPending.mockResolvedValue({ conversations: [{ id: 9, firstSeen: hours(1) }], journals: [] });
    const d = deps(changes());
    d.processConversation.mockRejectedValueOnce(Object.assign(new Error("nf"), { status: 404 }));
    const r = await runBeeChangesSync(d as never);
    expect(saved()).toEqual({ conversations: [], journals: [] });
    expect(r.gone).toBe(1);
  });

  it("a pending item that fails normally is kept (retried next run until it expires)", async () => {
    const first = hours(1);
    cursors.getPending.mockResolvedValue({ conversations: [{ id: 9, firstSeen: first }], journals: [] });
    const d = deps(changes());
    d.processConversation.mockRejectedValueOnce(new Error("boom"));
    await runBeeChangesSync(d as never);
    expect(cursors.savePending).not.toHaveBeenCalled(); // unchanged: kept until it expires
  });

  it("saves the pending list even when the main cursor is held (feed fetch fails)", async () => {
    cursors.getPending.mockResolvedValue({ conversations: [{ id: 9, firstSeen: hours(1) }], journals: [] });
    const d = deps(changes());
    d.processConversation.mockResolvedValueOnce({ ...convResult } as never);
    d.bee.changes.mockRejectedValueOnce(new Error("bee 503"));
    await expect(runBeeChangesSync(d as never)).rejects.toThrow("bee 503");
    expect(saved()).toEqual({ conversations: [], journals: [] });
    expect(cursors.saveCursor).not.toHaveBeenCalled();
  });

  it("does not rewrite the pending list when nothing changed", async () => {
    await runBeeChangesSync(deps(changes()) as never);
    expect(cursors.savePending).not.toHaveBeenCalled();
  });
});
