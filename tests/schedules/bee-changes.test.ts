import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("eve/schedules", () => ({ defineSchedule: <T>(s: T) => s }));
vi.mock("../../agent/lib/sync/bee-changes", () => ({ runBeeChangesSync: vi.fn() }));
vi.mock("../../agent/lib/ideas/one-pager", () => ({ draftBlooms: vi.fn(async () => []) }));

import schedule from "../../agent/schedules/bee-changes";
import { draftBlooms } from "../../agent/lib/ideas/one-pager";
import { runBeeChangesSync } from "../../agent/lib/sync/bee-changes";

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
    await expect(run()).rejects.toBe(boom);
    expect(draftBlooms).toHaveBeenCalledTimes(1);
  });

  it("a failing draft tail never masks the sync result", async () => {
    vi.mocked(runBeeChangesSync).mockResolvedValueOnce({} as never);
    vi.mocked(draftBlooms).mockRejectedValueOnce(new Error("db down"));
    await expect(run()).resolves.toBeUndefined();
  });
});
