import { beforeEach, describe, expect, it, vi } from "vitest";

const sql = vi.fn();
vi.mock("../../../agent/lib/db", () => ({ db: () => sql }));
const createTodo = vi.fn();
vi.mock("../../../agent/lib/sync/bee-todos", () => ({ createEarmarkTodo: (...a: unknown[]) => createTodo(...a) }));
const setStatus = vi.fn();
vi.mock("../../../agent/lib/recs/status", async (orig) => ({
  ...(await orig<object>()), setRecStatus: (...a: unknown[]) => setStatus(...a),
}));

import {
  approveReceipt, chicagoLocalToUtc, deferReceipt, draftReceipt, getPublicReceipt, handleReceiptTodoChange,
  markReceiptSentFromTodo, receiptUrl,
} from "../../../agent/lib/recs/receipts";

const text = (call: unknown[]) => (call[0] as TemplateStringsArray).join("?");
const NOW = new Date("2026-10-16T12:00:00Z");
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
  it("clamps name, creator and type to 120 characters in the prompt", async () => {
    sql.mockResolvedValueOnce([{ ...lovedRec, canonical_name: "N".repeat(500), creator: "C".repeat(500), type: "T".repeat(500) }]).mockResolvedValueOnce([{ id: 1, share_token: "t" }]);
    let prompt = "";
    await draftReceipt(4, (async (o: { prompt: string }) => { prompt = o.prompt; return { output: { message: "Ann — thank you so much." } }; }) as never);
    expect(prompt).toContain("N".repeat(120));
    expect(prompt).not.toContain("N".repeat(121));
    expect(prompt).not.toContain("C".repeat(121));
    expect(prompt).not.toContain("T".repeat(121));
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
    const url = await approveReceipt(4, 11, "  Thank you, Ann.  ");
    expect(text(sql.mock.calls[0])).toContain("recommendation_id =");
    expect(sql.mock.calls[0].slice(1)).toContain(4);
    expect(url).toBe(`https://earmark.test/r/${TOKEN}`);
    expect(sql.mock.calls[0].slice(1)).toContain("Thank you, Ann.");
    expect(text(sql.mock.calls[0])).not.toContain("recommendations");
    expect(setStatus).toHaveBeenCalledWith(4, "thanked", "garden", { defer: undefined });
  });
  it("hands the server action's defer to setRecStatus so the tap never waits on Bee", async () => {
    sql.mockResolvedValueOnce([{ share_token: TOKEN, recommendation_id: 4 }]);
    const defer = vi.fn();
    await approveReceipt(4, 11, "Thanks, Ann.", defer);
    expect(setStatus).toHaveBeenCalledWith(4, "thanked", "garden", { defer });
  });
  it("refuses an empty note and an unknown receipt", async () => {
    await expect(approveReceipt(4, 11, "   ")).rejects.toThrow(/empty/);
    sql.mockResolvedValueOnce([]);
    await expect(approveReceipt(4, 99, "hi there")).rejects.toThrow(/not found/);
    expect(setStatus).not.toHaveBeenCalled();
  });
});

describe("deferReceipt", () => {
  const row = { id: 11, canonical_name: "Ramen Kyuu", recommender_id: 7, first_name: "Ann", bee_todo_id: null };
  it("creates an Earmark todo with the alarm and stores its id", async () => {
    sql.mockResolvedValueOnce([row]).mockResolvedValueOnce([]);
    createTodo.mockResolvedValueOnce({ todoId: 501 });
    await deferReceipt(11, new Date("2026-10-20T23:00:00Z"), NOW);
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
    await expect(deferReceipt(11, new Date("2026-10-20T23:00:00Z"), NOW)).rejects.toThrow(msg);
    expect(sql).toHaveBeenCalledTimes(1);
  });
  it("does not overwrite the alarm when the todo is already open", async () => {
    sql.mockResolvedValueOnce([{ ...row, bee_todo_id: 501 }]);
    createTodo.mockResolvedValueOnce({ todoId: 501 });
    await expect(deferReceipt(11, new Date("2026-10-20T23:00:00Z"), NOW)).rejects.toThrow("A Bee reminder for this thank-you is already open");
    expect(sql).toHaveBeenCalledTimes(1);
  });
  it("rejects a time in the past before touching Bee", async () => {
    sql.mockResolvedValueOnce([row]);
    await expect(deferReceipt(11, new Date("2026-10-15T23:00:00Z"), NOW)).rejects.toThrow("Pick a time in the future");
    expect(createTodo).not.toHaveBeenCalled();
  });
  it("does not set a reminder to thank the owner", async () => {
    sql.mockResolvedValueOnce([{ ...row, first_name: "Tarik" }]);
    await expect(deferReceipt(11, new Date("2026-10-20T23:00:00Z"), NOW)).rejects.toThrow(/recommender/);
    expect(createTodo).not.toHaveBeenCalled();
  });
});

describe("chicagoLocalToUtc", () => {
  it("converts Chicago wall time to UTC across DST", () => {
    expect(chicagoLocalToUtc("2026-10-20T18:00").toISOString()).toBe("2026-10-20T23:00:00.000Z"); // CDT
    expect(chicagoLocalToUtc("2026-12-01T18:00").toISOString()).toBe("2026-12-02T00:00:00.000Z"); // CST
  });
  it("is right on DST days", () => {
    expect(chicagoLocalToUtc("2026-03-08T03:30").toISOString()).toBe("2026-03-08T08:30:00.000Z"); // just after spring-forward
    expect(chicagoLocalToUtc("2026-11-01T02:30").toISOString()).toBe("2026-11-01T08:30:00.000Z"); // after fall-back
  });
  it("rejects anything that is not a date and time", () => {
    expect(() => chicagoLocalToUtc("")).toThrow(/date and time/);
    expect(() => chicagoLocalToUtc("tomorrow")).toThrow(/date and time/);
    expect(() => chicagoLocalToUtc("2026-02-30T10:00")).toThrow("That date and time don't exist");
    expect(() => chicagoLocalToUtc("2026-13-01T10:00")).toThrow("That date and time don't exist");
  });
});

describe("markReceiptSentFromTodo / handleReceiptTodoChange", () => {
  it("marks the receipt sent and the tip thanked via setRecStatus (origin bee)", async () => {
    sql.mockResolvedValueOnce([{ recommendation_id: 4 }]);
    await markReceiptSentFromTodo(11);
    expect(setStatus).toHaveBeenCalledWith(4, "thanked", "bee");
    // privacy: an unreviewed draft must never become public
    expect(text(sql.mock.calls[0])).not.toContain("approved_at");
    expect(text(sql.mock.calls[0])).toContain("sent_via = coalesce(sent_via, 'text')");
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

describe("receiptUrl", () => {
  it("builds the public link from the token and the public base URL", () => {
    expect(receiptUrl(TOKEN)).toBe(`https://earmark.test/r/${TOKEN}`);
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
