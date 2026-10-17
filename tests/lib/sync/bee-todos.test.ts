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

  it("nudges the reconciler only when a tip enters or leaves 'queued'", async () => {
    const change = { recId: 1, origin: "garden" as const, recommenderId: null };
    const drain = vi.fn(async () => ({ status: "skipped" as const }));
    await beeTodoEffect({ ...change, previous: "new", next: "dismissed" }, drain);
    expect(drain).not.toHaveBeenCalled();
    await beeTodoEffect({ ...change, previous: "new", next: "queued" }, drain);
    await beeTodoEffect({ ...change, previous: "queued", next: "tried" }, drain);
    expect(drain).toHaveBeenCalledTimes(2);
  });
});
