import { describe, expect, it, vi } from "vitest";

vi.mock("eve/schedules", () => ({ defineSchedule: <T>(s: T) => s }));
vi.mock("../../agent/lib/facts/proposals", () => ({
  proposeTasteFacts: vi.fn(async () => ["Loves spiritual jazz"]),
  proposeIdeaFacts: vi.fn(async () => 1),
  writePendingProposals: vi.fn(async () => 2),
}));

import schedule from "../../agent/schedules/fact-proposals";
import { proposeIdeaFacts, proposeTasteFacts, writePendingProposals } from "../../agent/lib/facts/proposals";

describe("fact-proposals schedule (M5-T7)", () => {
  it("runs weekly: proposes tastes and ideas, then writes them to Bee, and logs counts only", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const s = schedule as unknown as { cron: string; run: () => Promise<void> };
    expect(s.cron).toBe("0 14 * * 1");
    await s.run();
    const order = [proposeTasteFacts, proposeIdeaFacts, writePendingProposals].map((f) => vi.mocked(f).mock.invocationCallOrder[0]!);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(info).toHaveBeenCalledWith("[earmark] fact-proposals", { tastes: 1, ideas: 1, written: 2 });
  });

  it("isolates the steps: a failed taste step does not block ideas or writing, and logs the error name only", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.mocked(proposeTasteFacts).mockRejectedValueOnce(Object.assign(new Error("Bee said: Loves private text"), { name: "BeeApiError" }));
    const s = schedule as unknown as { run: () => Promise<void> };
    await expect(s.run()).rejects.toThrow(/1 step/);
    expect(proposeIdeaFacts).toHaveBeenCalled();
    expect(writePendingProposals).toHaveBeenCalled();
    expect(JSON.stringify(err.mock.calls)).toMatch(/BeeApiError/);
    expect(JSON.stringify(err.mock.calls)).not.toMatch(/private/);
  });
});
