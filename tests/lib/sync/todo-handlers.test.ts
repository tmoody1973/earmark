import { describe, expect, it, vi } from "vitest";

// Pure parts only; the SQL runs in tests/integration/todo-change.int.test.ts.
vi.mock("../../../agent/lib/db", () => ({ db: () => { throw new Error("db must not be touched"); } }));

import { isEcho, recTodoAction, TODO_CHANGE_HANDLERS } from "../../../agent/lib/sync/todo-handlers";

const text = "Earmark · Listen: Promises";
const todo = (t: Partial<{ text: string; completed: boolean }> = {}) => ({ id: 1, text, completed: false, alarm_at: null, ...t });
const open = { text, completed: false };
const done = { text, completed: true };

describe("isEcho (the change is exactly what Earmark last wrote)", () => {
  it("is true only when text and completed both match", () => {
    expect(isEcho(open, todo())).toBe(true);
    expect(isEcho(done, todo({ completed: true }))).toBe(true);
    expect(isEcho(open, todo({ completed: true }))).toBe(false);
    expect(isEcho(open, todo({ text: "edited in Bee" }))).toBe(false);
  });
  it("is false for a deletion or a row with no recorded state", () => {
    expect(isEcho(open, null)).toBe(false);
    expect(isEcho(null, todo())).toBe(false);
  });
});

describe("recTodoAction", () => {
  it("marks tried when Bee completed a todo Earmark last wrote open", () => {
    expect(recTodoAction(open, todo({ completed: true }))).toBe("mark_tried");
  });
  it("ignores Earmark's own completion coming back", () => {
    expect(recTodoAction(done, todo({ completed: true }))).toBe("ignore");
  });
  it("ignores a text-only edit: Tarik's wording is never overwritten or acted on", () => {
    expect(recTodoAction(open, todo({ text: "my words" }))).toBe("ignore");
    expect(recTodoAction(done, todo({ text: "my words", completed: true }))).toBe("ignore");
  });
  it("requeues when a completed todo was unchecked in Bee", () => {
    expect(recTodoAction(done, todo())).toBe("requeue");
  });
  it("unlinks when the todo is gone from Bee (404)", () => {
    expect(recTodoAction(open, null)).toBe("unlink");
    expect(recTodoAction(done, null)).toBe("unlink");
  });
  it("treats a missing recorded state as open", () => {
    expect(recTodoAction(null, todo({ completed: true }))).toBe("mark_tried");
    expect(recTodoAction(null, todo())).toBe("ignore");
  });
});

describe("TODO_CHANGE_HANDLERS", () => {
  it("registers lane A's 'rec' handler, one entry per entity type", () => {
    const types = TODO_CHANGE_HANDLERS.map((h) => h.entityType);
    expect(types).toContain("rec");
    expect(new Set(types).size).toBe(types.length);
  });
});
