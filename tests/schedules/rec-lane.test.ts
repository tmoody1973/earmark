import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("eve/schedules", () => ({ defineSchedule: <T>(s: T) => s }));
vi.mock("../../agent/lib/recs/lane", () => ({ sweepRecLane: vi.fn() }));

import schedule from "../../agent/schedules/rec-lane";
import { sweepRecLane } from "../../agent/lib/recs/lane";

const s = schedule as unknown as { cron: string; run: () => Promise<void> };
let lines: string[];

beforeEach(() => {
  vi.clearAllMocks();
  lines = [];
  for (const m of ["log", "error"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { lines.push(a.join(" ")); });
});

describe("rec-lane schedule", () => {
  it("runs every 10 minutes and logs the sweep's counts", async () => {
    expect(s.cron).toBe("*/10 * * * *");
    vi.mocked(sweepRecLane).mockResolvedValueOnce({ status: "locked" });
    await s.run();
    expect(sweepRecLane).toHaveBeenCalledTimes(1);
    expect(lines.join("\n")).toContain("[rec-lane]");
  });

  it("logs only the error name when the sweep throws, and re-throws", async () => {
    const boom = Object.assign(new Error("SECRET text"), { name: "NeonDbError" });
    vi.mocked(sweepRecLane).mockRejectedValueOnce(boom);
    await expect(s.run()).rejects.toBe(boom);
    expect(lines.join("\n")).toContain("error=NeonDbError");
    expect(lines.join("\n")).not.toContain("SECRET");
  });
});
