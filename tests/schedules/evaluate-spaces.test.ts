import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("eve/schedules", () => ({ defineSchedule: <T>(s: T) => s }));
vi.mock("../../agent/lib/spaces/evaluate", () => ({ evaluateSpaces: vi.fn() }));

import schedule from "../../agent/schedules/evaluate-spaces";
import { evaluateSpaces } from "../../agent/lib/spaces/evaluate";

const s = schedule as unknown as { cron: string; run: () => Promise<void> };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("evaluate-spaces schedule (M4-T7)", () => {
  it("runs hourly at :37, away from the backlinks run at :07, with the default caps", async () => {
    expect(s.cron).toBe("37 * * * *");
    vi.mocked(evaluateSpaces).mockResolvedValueOnce({} as never);
    await s.run();
    expect(evaluateSpaces).toHaveBeenCalledWith();
  });

  it("logs the error name only and re-throws", async () => {
    const boom = Object.assign(new Error("Books to give my dad"), { name: "NeonDbError" });
    vi.mocked(evaluateSpaces).mockRejectedValueOnce(boom);
    await expect(s.run()).rejects.toBe(boom);
    const logged = vi.mocked(console.error).mock.calls.flat().join(" ");
    expect(logged).toContain("NeonDbError");
    expect(logged).not.toContain("dad");
  });
});
