import { expect, it, vi } from "vitest";

vi.mock("../../../agent/lib/db", () => ({ db: () => vi.fn() }));

import { handleReceiptTodoChange } from "../../../agent/lib/recs/receipts";
import { TODO_CHANGE_HANDLERS } from "../../../agent/lib/sync/todo-handlers";

it("registers the receipt check-off with lane A's todo change handlers (M5-T6)", () => {
  const entry = TODO_CHANGE_HANDLERS.find((h) => h.entityType === "rec_receipt");
  expect(entry?.run).toBe(handleReceiptTodoChange);
  expect(TODO_CHANGE_HANDLERS.some((h) => h.entityType === "place_nudge")).toBe(false); // nudges need no mirror
});
