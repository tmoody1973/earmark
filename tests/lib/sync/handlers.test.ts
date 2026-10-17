import { beforeEach, describe, expect, it, vi } from "vitest";

const sql = vi.fn();
vi.mock("../../../agent/lib/db", () => ({ db: () => sql }));
const getTodo = vi.fn();
vi.mock("../../../agent/lib/bee/client", async (orig) => ({
  ...(await orig<object>()),
  createBeeClient: () => ({ getTodo }),
}));
const handleReceipt = vi.fn();
vi.mock("../../../agent/lib/recs/receipts", () => ({ handleReceiptTodoChange: (...a: unknown[]) => handleReceipt(...a) }));
import { BeeApiError } from "../../../agent/lib/bee/client";
import { handleTodoChange } from "../../../agent/lib/sync/handlers";

beforeEach(() => { sql.mockReset(); getTodo.mockReset(); handleReceipt.mockReset(); });

describe("handleTodoChange (TEMP receipt dispatch, M5-T6)", () => {
  it("fetches a rec_receipt todo and hands it to the receipt handler", async () => {
    sql.mockResolvedValueOnce([{ entity_type: "rec_receipt", entity_id: 5 }]);
    const todo = { id: 9, text: "x", completed: true };
    getTodo.mockResolvedValueOnce(todo);
    await handleTodoChange(9);
    expect(handleReceipt).toHaveBeenCalledWith(5, todo);
    expect((sql.mock.calls[0][0] as TemplateStringsArray).join("?")).toContain("bee_object = 'todo'");
  });
  it("passes null when Bee answers 404, and rethrows other Bee errors", async () => {
    sql.mockResolvedValue([{ entity_type: "rec_receipt", entity_id: 5 }]);
    getTodo.mockRejectedValueOnce(new BeeApiError(404, "/v1/todos/9", "gone"));
    await handleTodoChange(9);
    expect(handleReceipt).toHaveBeenCalledWith(5, null);
    getTodo.mockRejectedValueOnce(new BeeApiError(503, "/v1/todos/9", "down"));
    await expect(handleTodoChange(9)).rejects.toThrow("Bee API 503");
  });
  it("leaves every other todo alone: no Bee call", async () => {
    sql.mockResolvedValueOnce([{ entity_type: "place_nudge", entity_id: 2 }]);
    await handleTodoChange(9);
    sql.mockResolvedValueOnce([]);
    await handleTodoChange(10);
    expect(getTodo).not.toHaveBeenCalled();
    expect(handleReceipt).not.toHaveBeenCalled();
  });
});
