import { describe, expect, it, vi } from "vitest";

vi.mock("eve/schedules", () => ({ defineSchedule: <T>(s: T) => s }));
const runDueGardeners = vi.fn(async () => ({ ran: 1, failed: 0 }));
vi.mock("../../agent/lib/gardeners/run", () => ({ runDueGardeners: (...a: unknown[]) => (runDueGardeners as (...x: unknown[]) => unknown)(...a) }));
import schedule from "../../agent/schedules/gardeners";

describe("gardeners schedule", () => {
  it("ticks hourly and logs counts only", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    expect((schedule as unknown as { cron: string }).cron).toBe("5 * * * *");
    await (schedule as unknown as { run: () => Promise<void> }).run();
    expect(runDueGardeners).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith("[gardeners] tick", { ran: 1, failed: 0 });
  });
});
