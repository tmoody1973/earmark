import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startPoller } from "../../../app/garden/poller";

let visible = true;
const isVisible = () => visible;

beforeEach(() => {
  vi.useFakeTimers();
  visible = true;
});
afterEach(() => vi.useRealTimers());

describe("startPoller (GardenLive's single poller)", () => {
  it("backs off after failures and drops back to 5 s after a success", async () => {
    const results = [false, false, true, true];
    const times: number[] = [];
    const poll = vi.fn(async () => {
      times.push(Date.now());
      if (!results.shift()) throw new Error("boom");
    });
    const t0 = Date.now();
    const p = startPoller({ poll, isVisible, onError: () => {} });
    await vi.advanceTimersByTimeAsync(5_000 + 10_000 + 20_000 + 5_000);
    expect(times.map((t) => t - t0)).toEqual([5_000, 15_000, 35_000, 40_000]);
    p.stop();
  });

  it("becoming visible while a poll is in flight starts no second request; the in-flight one schedules the next", async () => {
    let finish!: () => void;
    const poll = vi.fn(() => new Promise<void>((r) => { finish = r; }));
    const p = startPoller({ poll, isVisible, onError: () => {} });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(poll).toHaveBeenCalledTimes(1); // in flight
    visible = false;
    p.visibilityChanged();
    visible = true;
    p.visibilityChanged(); // resume: wants a poll now
    await vi.advanceTimersByTimeAsync(1_000);
    expect(poll).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(poll).toHaveBeenCalledTimes(2);
    p.stop();
  });

  it("rests while hidden and polls at once on return", async () => {
    const poll = vi.fn(async () => {});
    visible = false;
    const p = startPoller({ poll, isVisible, onError: () => {} });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(poll).not.toHaveBeenCalled();
    visible = true;
    p.visibilityChanged();
    await vi.advanceTimersByTimeAsync(0);
    expect(poll).toHaveBeenCalledTimes(1);
    p.stop();
  });

  it("stop aborts the request in flight and schedules nothing more", async () => {
    let seen: AbortSignal | undefined;
    const poll = vi.fn((signal: AbortSignal) => { seen = signal; return new Promise<void>(() => {}); });
    const p = startPoller({ poll, isVisible, onError: () => {} });
    await vi.advanceTimersByTimeAsync(5_000);
    p.stop();
    expect(seen?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(poll).toHaveBeenCalledTimes(1);
  });
});
