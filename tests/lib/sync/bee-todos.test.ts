import { beforeEach, describe, expect, it, vi } from "vitest";

// No database here: any query fails the test. The reconciler's SQL runs in tests/integration/bee-todos.int.test.ts.
vi.mock("../../../agent/lib/db", () => ({ db: () => { throw new Error("db must not be touched"); } }));

import { beeTodoEffect, drainTodoQueue } from "../../../agent/lib/sync/bee-todos";
import { STATUS_EFFECTS } from "../../../agent/lib/recs/status-effects";

const bee = () => ({ listTodos: vi.fn(), createTodo: vi.fn(), updateTodo: vi.fn(), deleteTodo: vi.fn() });

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("drainTodoQueue kill switch (BEE_TODO_WRITES)", () => {
  it.each([undefined, "", "off", "ON", "true"])("BEE_TODO_WRITES=%s: logs the skip and touches neither Bee nor Postgres", async (v) => {
    const b = bee();
    expect(await drainTodoQueue({ bee: b, env: { BEE_TODO_WRITES: v } })).toEqual({ status: "skipped" });
    expect(console.log).toHaveBeenCalledWith("[bee-todos] skipped: BEE_TODO_WRITES off");
    for (const fn of Object.values(b)) expect(fn).not.toHaveBeenCalled();
  });
});

describe("bee-todos status effect", () => {
  it("is registered in STATUS_EFFECTS", () => {
    expect(STATUS_EFFECTS.map((fx) => fx.name)).toContain("bee-todos");
  });

  const change = { recId: 1, origin: "garden" as const, recommenderId: null };

  it("nudges the reconciler only when a tip enters or leaves 'queued'", async () => {
    const drain = vi.fn(async () => ({ status: "skipped" as const }));
    const later = vi.fn((fn: () => unknown) => { void fn(); });
    await beeTodoEffect({ ...change, previous: "new", next: "dismissed" }, drain, later);
    expect(drain).not.toHaveBeenCalled();
    await beeTodoEffect({ ...change, previous: "new", next: "queued" }, drain, later);
    await beeTodoEffect({ ...change, previous: "queued", next: "tried" }, drain, later);
    expect(drain).toHaveBeenCalledTimes(2);
  });

  it("inside a request the tap doesn't wait on Bee: the drain is handed to after()", async () => {
    let release!: () => void;
    const drain = vi.fn(() => new Promise<void>((res) => { release = res; }));
    const queued: Array<() => unknown> = [];
    await beeTodoEffect({ ...change, previous: "new", next: "queued" }, drain, (fn) => { queued.push(fn); });
    expect(drain).not.toHaveBeenCalled(); // returned before any Bee work
    const done = queued[0]!();
    release();
    await done;
    expect(drain).toHaveBeenCalledTimes(1);
  });

  it("outside a request (after() throws: scripts, schedules) it awaits the drain", async () => {
    const order: string[] = [];
    const drain = vi.fn(async () => { order.push("drain"); });
    await beeTodoEffect({ ...change, previous: "queued", next: "new" }, drain, () => { throw new Error("outside request scope"); });
    order.push("returned");
    expect(order).toEqual(["drain", "returned"]);
    // The real next/server after() throws outside a request too, so the default path awaits.
    const real = vi.fn(async () => {});
    await beeTodoEffect({ ...change, previous: "queued", next: "new" }, real);
    expect(real).toHaveBeenCalledTimes(1);
  });

  it("a failing drain is logged by error name and never throws into the status change", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const drain = vi.fn(async () => { throw Object.assign(new Error("secret text"), { name: "BeeApiError" }); });
    await expect(beeTodoEffect({ ...change, previous: "new", next: "queued" }, drain, () => { throw new Error("no scope"); }))
      .resolves.toBeUndefined();
    expect(err).toHaveBeenCalledWith("[bee-todos] nudge failed error=BeeApiError");
  });
});

describe("createEarmarkTodo guards", () => {
  it("is a no-op behind the same kill switch", async () => {
    const { createEarmarkTodo } = await import("../../../agent/lib/sync/bee-todos");
    const b = bee();
    expect(await createEarmarkTodo({ entityType: "place_nudge", entityId: 3, text: "x", alarmAt: null }, { bee: b, env: {} }))
      .toEqual({ skipped: "off" });
    for (const fn of Object.values(b)) expect(fn).not.toHaveBeenCalled();
  });

  it("refuses rec todos (the reconciler owns those) and bad ids", async () => {
    const { createEarmarkTodo } = await import("../../../agent/lib/sync/bee-todos");
    const env = { BEE_TODO_WRITES: "on" };
    await expect(createEarmarkTodo({ entityType: "rec", entityId: 3, text: "x", alarmAt: null }, { bee: bee(), env })).rejects.toThrow();
    await expect(createEarmarkTodo({ entityType: "place_nudge", entityId: 0, text: "x", alarmAt: null }, { bee: bee(), env })).rejects.toThrow();
  });
});
