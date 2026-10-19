import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("eve/schedules", () => ({ defineSchedule: <T>(s: T) => s }));
vi.mock("../../agent/lib/recs/lane", () => ({ sweepRecLane: vi.fn() }));
vi.mock("../../agent/lib/ideas/research", () => ({ runIdeaResearch: vi.fn(async () => ({ status: "off" })) }));

import schedule from "../../agent/schedules/rec-lane";
import { sweepRecLane } from "../../agent/lib/recs/lane";
import { runIdeaResearch } from "../../agent/lib/ideas/research";

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
    await expect(s.run()).rejects.toThrow(new Error(boom.name));
    expect(lines.join("\n")).toContain("error=NeonDbError");
    expect(lines.join("\n")).not.toContain("SECRET");
  });

  it("researches requested ideas first (decision 057); a research failure is logged by name and the sweep still runs", async () => {
    vi.mocked(sweepRecLane).mockResolvedValueOnce({ status: "locked" });
    vi.mocked(runIdeaResearch).mockRejectedValueOnce(Object.assign(new Error("SECRET title"), { name: "NeonDbError" }));
    await s.run();
    expect(runIdeaResearch).toHaveBeenCalledTimes(1);
    expect(sweepRecLane).toHaveBeenCalledTimes(1);
    expect(lines.join("\n")).toContain("[research] failed error=NeonDbError");
    expect(lines.join("\n")).not.toContain("SECRET");
  });
});
