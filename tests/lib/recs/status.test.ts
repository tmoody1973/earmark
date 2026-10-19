import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeMockDb } from "../../helpers/mock-db";

const h = vi.hoisted(() => ({ mock: undefined as unknown as ReturnType<typeof import("../../helpers/mock-db").makeMockDb> }));
vi.mock("../../../agent/lib/db", () => ({ db: () => h.mock.sql }));

import {
  allowedFrom, mayMove, setRecRating, setRecStatus, type StatusChange, type StatusEffect,
} from "../../../agent/lib/recs/status";
import type { RecStatus } from "../../../agent/lib/types";

const flat = (s: string) => s.replace(/\s+/g, " ");
const effect = (name: string, run = vi.fn<(c: StatusChange) => Promise<void>>(async () => {})): StatusEffect & { run: typeof run } =>
  ({ name, run });

describe("mayMove (pure transition rules)", () => {
  it("never 'moves' a tip to the status it already has", () => {
    expect(mayMove("new", "new", "garden")).toBe(false);
  });

  it.each(["garden", "notion", "slack"] as const)("lets Tarik's own surface (%s) move any tip, even a cleared one", (o) => {
    expect(mayMove("dismissed", "new", o)).toBe(true);
    expect(mayMove("composted", "queued", o)).toBe(true);
    expect(mayMove("tried", "queued", o)).toBe(true);
  });

  it("never lets Bee's todo sync bring back a tip Tarik dismissed or composted", () => {
    expect(mayMove("dismissed", "queued", "bee")).toBe(false);
    expect(mayMove("composted", "tried", "bee")).toBe(false);
    expect(mayMove("queued", "tried", "bee")).toBe(true);
    expect(mayMove("tried", "queued", "bee")).toBe(true);
  });

  it("lets the system move only tips Earmark itself placed (needs_review, new), never a user-set state", () => {
    expect(mayMove("needs_review", "new", "system")).toBe(true);
    expect(mayMove("new", "composted", "system")).toBe(true);
    for (const from of ["queued", "tried", "thanked", "dismissed", "composted", "overheard"] as RecStatus[]) {
      expect(mayMove(from, "new", "system")).toBe(false);
    }
  });

  it("Heard nearby (decision 052): Tarik keeps (→ new) or clears (→ dismissed) an overheard tip; the system may file one there", () => {
    expect(mayMove("overheard", "new", "garden")).toBe(true);
    expect(mayMove("overheard", "dismissed", "garden")).toBe(true);
    expect(allowedFrom("new", "garden", ["overheard"])).toEqual(["overheard"]);
    expect(allowedFrom("overheard", "system")).toEqual(["needs_review", "new"]); // the backfill (move-to-heard-nearby.ts)
  });

  it("allowedFrom lists every status the move may start from, narrowed by the caller's own guard", () => {
    expect(allowedFrom("new", "system")).toEqual(["needs_review"]);
    expect(allowedFrom("dismissed", "garden", ["needs_review"])).toEqual(["needs_review"]);
    expect(allowedFrom("queued", "bee")).toEqual(["needs_review", "new", "tried", "thanked", "overheard"]);
    expect(allowedFrom("new", "system", ["queued"])).toEqual([]);
  });
});

describe("setRecStatus", () => {
  let err: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    h.mock = makeMockDb();
    err = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => err.mockRestore());

  it("writes in one statement guarded on the current status, and reports the previous one", async () => {
    h.mock.queue.push([{ previous: "new", recommender_id: 3 }]);
    const res = await setRecStatus(7, "tried", "garden", { effects: [] });
    expect(res).toEqual({ changed: true, previous: "new" });
    const write = h.mock.calls[0];
    expect(flat(write.text)).toContain("update recommendations r set status = ?");
    expect(flat(write.text)).toContain("updated_at = now()");
    expect(flat(write.text)).toContain("for update");
    expect(flat(write.text)).toContain("old.status = any(?::text[])");
    expect(write.values).toContain(7);
    expect(write.values).toContainEqual(["needs_review", "new", "queued", "thanked", "dismissed", "composted", "overheard"]);
  });

  it("is a no-op (nothing run) when the tip's current status may not move there", async () => {
    h.mock.queue.push([]);
    const fx = effect("fx");
    expect(await setRecStatus(7, "new", "system", { effects: [fx] })).toEqual({ changed: false, previous: null });
    expect(h.mock.calls).toHaveLength(1);
    expect(fx.run).not.toHaveBeenCalled();
  });

  it("skips the database entirely when no starting status could be allowed", async () => {
    expect(await setRecStatus(7, "new", "system", { from: ["dismissed"], effects: [] }))
      .toEqual({ changed: false, previous: null });
    expect(h.mock.calls).toHaveLength(0);
  });

  it("recounts the recommender, then runs each registered effect with the change, in order", async () => {
    h.mock.queue.push([{ previous: "queued", recommender_id: "3" }]);
    const order: string[] = [];
    const a = effect("a", vi.fn(async () => { order.push("a"); }));
    const b = effect("b", vi.fn(async () => { order.push("b"); }));
    await setRecStatus(7, "tried", "slack", { effects: [a, b] });
    expect(flat(h.mock.calls[1].text)).toContain("update recommenders p set");
    expect(h.mock.calls[1].values).toEqual([3]);
    const change: StatusChange = { recId: 7, previous: "queued", next: "tried", origin: "slack", recommenderId: 3 };
    expect(a.run).toHaveBeenCalledWith(change);
    expect(b.run).toHaveBeenCalledWith(change);
    expect(order).toEqual(["a", "b"]);
  });

  it("skips the recount for a tip nobody gave", async () => {
    h.mock.queue.push([{ previous: "new", recommender_id: null }]);
    await setRecStatus(7, "queued", "garden", { effects: [] });
    expect(h.mock.calls).toHaveLength(1);
  });

  it("a failing effect is logged with ids only and never stops the others or undoes the change", async () => {
    h.mock.queue.push([{ previous: "new", recommender_id: null }]);
    const boom = effect("bee-todos", vi.fn(async () => { throw Object.assign(new Error("secret transcript text"), { name: "BeeApiError" }); }));
    const after = effect("after");
    expect(await setRecStatus(7, "queued", "garden", { effects: [boom, after] })).toEqual({ changed: true, previous: "new" });
    expect(after.run).toHaveBeenCalled();
    const line = err.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(line).toContain("effect=bee-todos rec=7 error=BeeApiError");
    expect(line).not.toContain("secret transcript text");
  });

  it("with a defer, the tap returns before the effects run (the recount still runs first, awaited)", async () => {
    h.mock.queue.push([{ previous: "new", recommender_id: 3 }], []);
    const fx = effect("bee-todos");
    const deferred: Array<() => Promise<void>> = [];
    expect(await setRecStatus(7, "queued", "garden", { effects: [fx], defer: (fn) => { deferred.push(fn); } }))
      .toEqual({ changed: true, previous: "new" });
    expect(h.mock.calls).toHaveLength(2); // the status change and the recount
    expect(fx.run).not.toHaveBeenCalled();
    await deferred[0]!();
    expect(fx.run).toHaveBeenCalledTimes(1);
  });

  it("without a defer, the effects are awaited before it returns", async () => {
    h.mock.queue.push([{ previous: "new", recommender_id: null }]);
    const fx = effect("bee-todos");
    await setRecStatus(7, "queued", "garden", { effects: [fx] });
    expect(fx.run).toHaveBeenCalledTimes(1);
  });

  it("a deferred effect that throws is still logged, never thrown", async () => {
    h.mock.queue.push([{ previous: "new", recommender_id: null }]);
    const boom = effect("bee-todos", vi.fn(async () => { throw Object.assign(new Error("x"), { name: "BeeApiError" }); }));
    const deferred: Array<() => Promise<void>> = [];
    await setRecStatus(7, "queued", "garden", { effects: [boom], defer: (fn) => { deferred.push(fn); } });
    await expect(deferred[0]!()).resolves.toBeUndefined();
    expect(err.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n")).toContain("effect=bee-todos rec=7 error=BeeApiError");
  });

  it("records Tarik's Maybe? verdict in the same statement", async () => {
    h.mock.queue.push([{ previous: "needs_review", recommender_id: null }]);
    await setRecStatus(7, "new", "garden", { from: ["needs_review"], verdict: "kept", effects: [] });
    expect(flat(h.mock.calls[0].text)).toContain("user_verdict = coalesce(?::text, r.user_verdict)");
    expect(h.mock.calls[0].values).toContain("kept");
    expect(h.mock.calls[0].values).toContainEqual(["needs_review"]);
  });

  it("rejects an id that is not a positive integer before touching the database", async () => {
    await expect(setRecStatus(0, "new", "garden")).rejects.toThrow("invalid rec id");
    await expect(setRecStatus(1.5, "new", "garden")).rejects.toThrow("invalid rec id");
    expect(h.mock.calls).toHaveLength(0);
  });
});

describe("setRecRating", () => {
  beforeEach(() => { h.mock = makeMockDb(); });

  it("rating a new or queued tip means Tarik tried it", async () => {
    h.mock.queue.push([{ status: "queued", recommender_id: 3 }], [{ previous: "queued", recommender_id: 3 }]);
    await setRecRating(7, "loved", "notion", { effects: [] });
    expect(flat(h.mock.calls[0].text)).toContain("update recommendations set rating = ?");
    expect(flat(h.mock.calls[0].text)).toContain("rating is distinct from ?");
    expect(flat(h.mock.calls[1].text)).toContain("update recommendations r set status = ?");
    expect(h.mock.calls[1].values).toContain("tried");
    expect(h.mock.calls[1].values).toContainEqual(["new", "queued"]);
  });

  it("clearing a rating only recounts the recommender", async () => {
    h.mock.queue.push([{ status: "tried", recommender_id: 3 }]);
    await setRecRating(7, null, "notion", { effects: [] });
    expect(h.mock.calls).toHaveLength(2);
    expect(flat(h.mock.calls[1].text)).toContain("update recommenders p set");
  });

  it("does nothing more when the rating is unchanged or the tip is gone", async () => {
    h.mock.queue.push([]);
    expect(await setRecRating(7, "fine", "slack", { effects: [] })).toEqual({ changed: false });
    expect(h.mock.calls).toHaveLength(1);
  });

  it("never rates a tip the shelf hides (a maybe, a dismissed or composted tip): guarded in the same statement", async () => {
    h.mock.queue.push([]);
    expect(await setRecRating(7, "loved", "garden", { effects: [] })).toEqual({ changed: false });
    expect(flat(h.mock.calls[0].text)).toContain("and status <> all(?::text[])");
    expect(h.mock.calls[0].values).toContainEqual(["dismissed", "composted", "needs_review", "overheard"]);
    expect(h.mock.calls).toHaveLength(1);
  });

  it("says whether the rating changed, so the garden can tell a no-op from a save", async () => {
    h.mock.queue.push([{ status: "tried", recommender_id: null }]);
    expect(await setRecRating(7, "fine", "garden", { effects: [] })).toEqual({ changed: true });
    h.mock.queue.push([{ status: "new", recommender_id: 3 }], [{ previous: "new", recommender_id: 3 }]);
    expect(await setRecRating(7, "loved", "garden", { effects: [] })).toEqual({ changed: true });
  });
});
