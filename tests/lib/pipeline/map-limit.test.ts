import { describe, expect, it } from "vitest";
import { mapLimit } from "../../../agent/lib/pipeline/map-limit";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("mapLimit", () => {
  it("runs at most `limit` calls at once and returns results in input order", async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapLimit([30, 5, 20, 1, 15, 10, 2], 4, async (ms, i) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await sleep(ms);
      inFlight--;
      return `r${i}`;
    });
    expect(out).toEqual(["r0", "r1", "r2", "r3", "r4", "r5", "r6"]);
    expect(peak).toBe(4);
  });

  it("returns [] for no items and never calls fn", async () => {
    let calls = 0;
    expect(await mapLimit([], 4, async () => ++calls)).toEqual([]);
    expect(calls).toBe(0);
  });
});
