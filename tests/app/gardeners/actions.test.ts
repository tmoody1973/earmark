import { beforeEach, describe, expect, it, vi } from "vitest";

const sql = vi.fn();
vi.mock("@/agent/lib/db", () => ({ db: () => sql }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const requireOwner = vi.fn();
vi.mock("../../../app/gardeners/owner", () => ({ requireOwner: () => requireOwner() }));
import { runNow, setGardenerEnabled, setRunStatus } from "../../../app/gardeners/actions";

beforeEach(() => { sql.mockReset(); requireOwner.mockReset(); });

describe("gardener actions are owner-only", () => {
  beforeEach(() => { requireOwner.mockRejectedValue(new Error("not found")); });
  it("refuse a non-owner before touching the database", async () => {
    await expect(setGardenerEnabled(1, false)).rejects.toThrow("not found");
    await expect(runNow(1)).rejects.toThrow("not found");
    await expect(setRunStatus(1, "approved")).rejects.toThrow("not found");
    expect(sql).not.toHaveBeenCalled();
  });
});

describe("setGardenerEnabled", () => {
  it("validates input and writes the flag", async () => {
    requireOwner.mockResolvedValue(undefined);
    sql.mockResolvedValue([]);
    await setGardenerEnabled(3, false);
    expect(sql.mock.calls[0].slice(1)).toEqual([false, 3]);
    await expect(setGardenerEnabled(-1, true)).rejects.toThrow();
    await expect(setGardenerEnabled(1, "no" as never)).rejects.toThrow();
    expect(sql).toHaveBeenCalledTimes(1);
  });
});
