import { beforeEach, describe, expect, it, vi } from "vitest";

// No database here: any query fails the test. The reconciler's SQL runs in tests/integration/bee-todos.int.test.ts.
vi.mock("../../../agent/lib/db", () => ({ db: () => { throw new Error("db must not be touched"); } }));

import { beeTodoEffect, drainTodoQueue } from "../../../agent/lib/sync/bee-todos";
import { STATUS_EFFECTS } from "../../../agent/lib/recs/status-effects";

const bee = () => ({ listTodos: vi.fn(), createTodo: vi.fn(), updateTodo: vi.fn(), deleteTodo: vi.fn(), getTodo: vi.fn() });

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
    await beeTodoEffect({ ...change, previous: "new", next: "dismissed" }, drain);
    expect(drain).not.toHaveBeenCalled();
    await beeTodoEffect({ ...change, previous: "new", next: "queued" }, drain);
    await beeTodoEffect({ ...change, previous: "queued", next: "tried" }, drain);
    expect(drain).toHaveBeenCalledTimes(2);
  });

  it("awaits the drain itself (deferring is the caller's job: setRecStatus's `defer`)", async () => {
    const order: string[] = [];
    const drain = vi.fn(async () => { order.push("drain"); });
    await beeTodoEffect({ ...change, previous: "queued", next: "new" }, drain);
    order.push("returned");
    expect(order).toEqual(["drain", "returned"]);
  });

  it("a failing drain is logged by error name and never throws into the status change", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const drain = vi.fn(async () => { throw Object.assign(new Error("secret text"), { name: "BeeApiError" }); });
    await expect(beeTodoEffect({ ...change, previous: "new", next: "queued" }, drain)).resolves.toBeUndefined();
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
