import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("eve/schedules", () => ({ defineSchedule: <T>(s: T) => s }));
vi.mock("../../agent/lib/sync/bee-changes", () => ({ runBeeChangesSync: vi.fn() }));
vi.mock("../../agent/lib/ideas/one-pager", () => ({ draftBlooms: vi.fn(async () => []) }));
vi.mock("../../agent/lib/sync/bee-todos", () => ({ drainTodoQueue: vi.fn(async () => ({ status: "skipped" })) }));

import schedule from "../../agent/schedules/bee-changes";
import { draftBlooms } from "../../agent/lib/ideas/one-pager";
import { runBeeChangesSync } from "../../agent/lib/sync/bee-changes";
import { drainTodoQueue } from "../../agent/lib/sync/bee-todos";

const run = () => (schedule as unknown as { run: () => Promise<void> }).run();

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("bee-changes schedule tail (M2-T7)", () => {
  it("drafts blooms after a successful sync", async () => {
    vi.mocked(runBeeChangesSync).mockResolvedValueOnce({} as never);
    await run();
    expect(draftBlooms).toHaveBeenCalledWith();
    expect(vi.mocked(runBeeChangesSync).mock.invocationCallOrder[0]!).toBeLessThan(vi.mocked(draftBlooms).mock.invocationCallOrder[0]!);
  });

  it("still drafts when the sync throws, and re-throws the sync's own error", async () => {
    const boom = Object.assign(new Error("x"), { name: "BeeApiError" });
    vi.mocked(runBeeChangesSync).mockRejectedValueOnce(boom);
    await expect(run()).rejects.toThrow(new Error(boom.name));
    expect(draftBlooms).toHaveBeenCalledTimes(1);
  });

  it("a failing draft tail never masks the sync result", async () => {
    vi.mocked(runBeeChangesSync).mockResolvedValueOnce({} as never);
    vi.mocked(draftBlooms).mockRejectedValueOnce(new Error("db down"));
    await expect(run()).resolves.toBeUndefined();
  });

  it("reconciles Bee todos every run (M3-T7), even when the sync throws, and a failing reconcile never throws", async () => {
    vi.mocked(runBeeChangesSync).mockRejectedValueOnce(new Error("x"));
    await expect(run()).rejects.toThrow("Error");
    expect(drainTodoQueue).toHaveBeenCalledTimes(1);
    vi.mocked(runBeeChangesSync).mockResolvedValueOnce({} as never);
    vi.mocked(drainTodoQueue).mockRejectedValueOnce(Object.assign(new Error("db"), { name: "NeonDbError" }));
    await expect(run()).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith("[bee-todos] reconcile failed error=NeonDbError");
  });
});
