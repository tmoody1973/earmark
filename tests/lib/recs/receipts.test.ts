import { beforeEach, describe, expect, it, vi } from "vitest";

const sql = vi.fn();
vi.mock("../../../agent/lib/db", () => ({ db: () => sql }));
const createTodo = vi.fn();
vi.mock("../../../agent/lib/sync/bee-todos", () => ({ createEarmarkTodo: (...a: unknown[]) => createTodo(...a) }));
const setStatus = vi.fn();
vi.mock("../../../agent/lib/recs/status", () => ({ setRecStatus: (...a: unknown[]) => setStatus(...a) }));

import {
  approveReceipt, chicagoLocalToUtc, deferReceipt, draftReceipt, getPublicReceipt, handleReceiptTodoChange,
  markReceiptSentFromTodo,
} from "../../../agent/lib/recs/receipts";

const text = (call: unknown[]) => (call[0] as TemplateStringsArray).join("?");
const TOKEN = "A".repeat(43);
const lovedRec = { id: 4, canonical_name: "Ramen Kyuu", creator: null, type: "place", rating: "loved", excerpt: "the broth is the reason to go, she said twice", recommender_id: 7, first_name: "Ann" };

beforeEach(() => {
  sql.mockReset();
  createTodo.mockReset();
  setStatus.mockReset();
  setStatus.mockResolvedValue({ changed: true, previous: "tried" });
  process.env.EARMARK_PUBLIC_BASE_URL = "https://earmark.test";
  process.env.EARMARK_OWNER_FIRST_NAME = "Tarik";
});

describe("draftReceipt", () => {
  it("writes a short note without quoting the conversation and stores a token", async () => {
    sql.mockResolvedValueOnce([lovedRec]).mockResolvedValueOnce([{ id: 11, share_token: "tok" }]);
    const generateImpl = vi.fn(async (opts: { prompt: string }) => {
      expect(opts.prompt).toContain("Ann");
      expect(opts.prompt).toContain("Ramen Kyuu");
      expect(opts.prompt).toContain("Tarik");
      expect(opts.prompt).not.toContain("broth");
      return { output: { message: "Ann — went to Ramen Kyuu on your tip. You were right. Thank you." } };
    });
    const r = await draftReceipt(4, generateImpl as never);
    expect(r).toEqual({ receiptId: 11, token: "tok" });
    expect(sql.mock.calls[1].slice(1)).toContain("Ann — went to Ramen Kyuu on your tip. You were right. Thank you.");
    expect(text(sql.mock.calls[0])).not.toContain("excerpt");
  });
  it("refuses a rec that is not loved or has no recommender", async () => {
    sql.mockResolvedValueOnce([{ ...lovedRec, rating: "fine" }]);
    await expect(draftReceipt(4, vi.fn() as never)).rejects.toThrow(/loved/);
    sql.mockResolvedValueOnce([{ ...lovedRec, first_name: null, recommender_id: null }]);
    await expect(draftReceipt(4, vi.fn() as never)).rejects.toThrow(/recommender/);
  });
  it("never thanks the owner: same refusal, no model call", async () => {
    sql.mockResolvedValueOnce([{ ...lovedRec, first_name: "Tarik" }]);
    const gen = vi.fn();
    await expect(draftReceipt(4, gen as never)).rejects.toThrow(/no recommender to thank/);
    expect(gen).not.toHaveBeenCalled();
  });
});

describe("approveReceipt", () => {
  it("saves the edited note, marks the tip thanked through setRecStatus and returns the public link", async () => {
    sql.mockResolvedValueOnce([{ share_token: TOKEN, recommendation_id: 4 }]);
    const url = await approveReceipt(11, "  Thank you, Ann.  ");
    expect(url).toBe(`https://earmark.test/r/${TOKEN}`);
    expect(sql.mock.calls[0].slice(1)).toContain("Thank you, Ann.");
    expect(text(sql.mock.calls[0])).not.toContain("recommendations");
    expect(setStatus).toHaveBeenCalledWith(4, "thanked", "garden");
  });
  it("refuses an empty note and an unknown receipt", async () => {
    await expect(approveReceipt(11, "   ")).rejects.toThrow(/empty/);
    sql.mockResolvedValueOnce([]);
    await expect(approveReceipt(99, "hi there")).rejects.toThrow(/not found/);
    expect(setStatus).not.toHaveBeenCalled();
  });
});

describe("deferReceipt", () => {
  const row = { id: 11, canonical_name: "Ramen Kyuu", recommender_id: 7, first_name: "Ann" };
  it("creates an Earmark todo with the alarm and stores its id", async () => {
    sql.mockResolvedValueOnce([row]).mockResolvedValueOnce([]);
    createTodo.mockResolvedValueOnce({ todoId: 501 });
    await deferReceipt(11, new Date("2026-10-20T23:00:00Z"));
    expect(createTodo).toHaveBeenCalledWith({
      entityType: "rec_receipt", entityId: 11, text: "Earmark · Thank Ann for the Ramen Kyuu tip", alarmAt: "2026-10-20T23:00:00.000Z",
    });
    expect(sql.mock.calls[1].slice(1)).toContain(501);
  });
  it.each([
    ["cap", /10 open Earmark todos already; finish one first/],
    ["off", /Bee reminders are switched off right now/],
    ["locked", /Bee is busy; try again in a minute/],
  ] as const)("says why in plain English when the todo is skipped (%s)", async (skipped, msg) => {
    sql.mockResolvedValueOnce([row]);
    createTodo.mockResolvedValueOnce({ skipped });
    await expect(deferReceipt(11, new Date("2026-10-20T23:00:00Z"))).rejects.toThrow(msg);
    expect(sql).toHaveBeenCalledTimes(1);
  });
  it("does not set a reminder to thank the owner", async () => {
    sql.mockResolvedValueOnce([{ ...row, first_name: "Tarik" }]);
    await expect(deferReceipt(11, new Date())).rejects.toThrow(/recommender/);
    expect(createTodo).not.toHaveBeenCalled();
  });
});

describe("chicagoLocalToUtc", () => {
  it("converts Chicago wall time to UTC across DST", () => {
    expect(chicagoLocalToUtc("2026-10-20T18:00").toISOString()).toBe("2026-10-20T23:00:00.000Z"); // CDT
    expect(chicagoLocalToUtc("2026-12-01T18:00").toISOString()).toBe("2026-12-02T00:00:00.000Z"); // CST
  });
  it("rejects anything that is not a date and time", () => {
    expect(() => chicagoLocalToUtc("")).toThrow(/date and time/);
    expect(() => chicagoLocalToUtc("tomorrow")).toThrow(/date and time/);
  });
});

describe("markReceiptSentFromTodo / handleReceiptTodoChange", () => {
  it("marks the receipt sent and the tip thanked via setRecStatus (origin bee)", async () => {
    sql.mockResolvedValueOnce([{ recommendation_id: 4 }]);
    await markReceiptSentFromTodo(11);
    expect(setStatus).toHaveBeenCalledWith(4, "thanked", "bee");
  });
  it("does nothing for a receipt that no longer exists", async () => {
    sql.mockResolvedValueOnce([]);
    await markReceiptSentFromTodo(11);
    expect(setStatus).not.toHaveBeenCalled();
  });
  it("acts only on a completed todo; a 404 (null) or an open todo is a no-op", async () => {
    await handleReceiptTodoChange(11, null);
    await handleReceiptTodoChange(11, { id: 9, text: "x", completed: false });
    expect(sql).not.toHaveBeenCalled();
    sql.mockResolvedValueOnce([{ recommendation_id: 4 }]);
    await handleReceiptTodoChange(11, { id: 9, text: "x", completed: true });
    expect(setStatus).toHaveBeenCalledWith(4, "thanked", "bee");
  });
});

describe("getPublicReceipt", () => {
  it("only returns approved receipts and never selects the excerpt", async () => {
    sql.mockResolvedValueOnce([]);
    expect(await getPublicReceipt(TOKEN)).toBeNull();
    const q = text(sql.mock.calls[0]);
    expect(q).toContain("approved_at is not null");
    expect(q).not.toContain("excerpt");
  });
  it("rejects a malformed token before querying", async () => {
    for (const t of ["nope", "", `${"A".repeat(42)}!`, "A".repeat(44), `${"A".repeat(42)}%`]) expect(await getPublicReceipt(t)).toBeNull();
    expect(sql).not.toHaveBeenCalled();
  });
  it("maps the row", async () => {
    sql.mockResolvedValueOnce([{ message: "m", canonical_name: "Ramen Kyuu", creator: null, image_url: null, type: "place" }]);
    expect(await getPublicReceipt(TOKEN)).toEqual({ message: "m", name: "Ramen Kyuu", creator: null, imageUrl: null, type: "place" });
  });
});
