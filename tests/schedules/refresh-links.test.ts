import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("eve/schedules", () => ({ defineSchedule: <T>(s: T) => s }));
vi.mock("../../agent/lib/links/refresh", () => ({ refreshLinks: vi.fn() }));

import schedule from "../../agent/schedules/refresh-links";
import { refreshLinks } from "../../agent/lib/links/refresh";

const s = schedule as unknown as { cron: string; run: () => Promise<void> };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("refresh-links schedule (M4-T6)", () => {
  it("runs hourly, off the hour, with the default per-run cap", async () => {
    expect(s.cron).toBe("7 * * * *");
    vi.mocked(refreshLinks).mockResolvedValueOnce({} as never);
    await s.run();
    expect(refreshLinks).toHaveBeenCalledWith();
  });

  it("logs the error name only and re-throws", async () => {
    const boom = Object.assign(new Error("idea text must not be logged"), { name: "NeonDbError" });
    vi.mocked(refreshLinks).mockRejectedValueOnce(boom);
    await expect(s.run()).rejects.toBe(boom);
    const logged = vi.mocked(console.error).mock.calls.flat().join(" ");
    expect(logged).toContain("NeonDbError");
    expect(logged).not.toContain("idea text");
  });
});
