import { describe, expect, it, vi } from "vitest";
import {
  executeForget, formatPlan, ForgetAbortedError, planForget, trashNotionPage, type ForgetDeps, type ForgetPlan,
} from "../../../agent/lib/privacy/forget";
import { parseForgetArgs } from "../../../scripts/forget";

// Spec tests from the M3-T11 brief (adapted from PostHog draft PR #8): outside deletes first, Postgres last (decision 011).
const refs = { exists: true, beeTodoIds: [10, 11], beeFactIds: [5], notionPageIds: ["pg1"], blobUrls: ["https://blob/t.jpg"] };
const target = { type: "rec" as const, id: 42 };

describe("planForget", () => {
  it("orders every external delete before the database delete", () => {
    const steps = planForget(target, refs);
    expect(steps.map((s) => s.kind)).toEqual(["bee_todo", "bee_todo", "bee_fact", "notion_page", "blob", "db"]);
    expect(steps.at(-1)).toEqual({ kind: "db", target });
  });
  it("plans nothing for a missing item", () => {
    expect(planForget(target, { ...refs, exists: false })).toEqual([]);
  });
});

describe("executeForget", () => {
  const deps = () => ({
    deleteTodo: vi.fn(async () => {}), deleteFact: vi.fn(async () => {}),
    trashNotionPage: vi.fn(async () => {}), deleteBlob: vi.fn(async () => {}), deleteRows: vi.fn(async () => {}),
  });
  const httpError = (status: number, name = "BeeApiError") => Object.assign(new Error(`secret body text ${status}`), { status, name });

  it("runs every step and logs each", async () => {
    const d = deps();
    const log = await executeForget(planForget(target, refs), d);
    expect(d.deleteTodo).toHaveBeenCalledTimes(2);
    expect(d.deleteFact).toHaveBeenCalledWith(5);
    expect(d.trashNotionPage).toHaveBeenCalledWith("pg1");
    expect(d.deleteBlob).toHaveBeenCalledWith("https://blob/t.jpg");
    expect(d.deleteRows).toHaveBeenCalledWith(target);
    expect(log).toHaveLength(6);
    expect(log).toEqual([
      "deleted bee_todo 10", "deleted bee_todo 11", "deleted bee_fact 5", "deleted notion_page pg1", "deleted blob #1", "deleted postgres rec 42",
    ]);
  });

  it("treats 'already gone' as success", async () => {
    const d = deps();
    d.deleteTodo.mockRejectedValueOnce(Object.assign(new Error("gone"), { status: 404 }));
    await executeForget(planForget(target, refs), d);
    expect(d.deleteRows).toHaveBeenCalled();
  });

  it("stops before touching Postgres when an external delete really fails", async () => {
    const d = deps();
    d.trashNotionPage.mockRejectedValueOnce(Object.assign(new Error("boom"), { status: 500 }));
    await expect(executeForget(planForget(target, refs), d)).rejects.toThrow("boom");
    expect(d.deleteRows).not.toHaveBeenCalled();
  });

  it("says which id failed by err.name only, with what was already done", async () => {
    const d = deps();
    d.trashNotionPage.mockRejectedValueOnce(httpError(500, "NotionApiError"));
    const err = await executeForget(planForget(target, refs), d).catch((e) => e);
    expect(err).toBeInstanceOf(ForgetAbortedError);
    expect(err.lines).toEqual(["deleted bee_todo 10", "deleted bee_todo 11", "deleted bee_fact 5", "FAILED notion_page pg1 error=NotionApiError"]);
    expect(err.lines.join("\n")).not.toContain("secret body text");
    expect(d.deleteBlob).not.toHaveBeenCalled();
  });

  it("aborts before Postgres when a service with refs is not configured", async () => {
    const d: ForgetDeps = { ...deps(), trashNotionPage: null };
    const err = await executeForget(planForget(target, refs), d).catch((e) => e);
    expect(err.lines).toContain("skipped: notion not configured (NOTION_TOKEN) notion_page pg1");
    expect(d.deleteRows).not.toHaveBeenCalled();
  });

  it("an unconfigured service with no refs of its kind is not a skip", async () => {
    const d: ForgetDeps = { ...deps(), trashNotionPage: null, deleteBlob: null };
    const log = await executeForget(planForget(target, { ...refs, notionPageIds: [], blobUrls: [] }), d);
    expect(log.join("\n")).not.toContain("skipped");
    expect(d.deleteRows).toHaveBeenCalledWith(target);
  });

  it("a Postgres failure is thrown as is, after the outside deletes (re-run: they 404 and count as done)", async () => {
    const d = deps();
    d.deleteRows.mockRejectedValueOnce(Object.assign(new Error("db down"), { name: "NeonDbError" }));
    await expect(executeForget(planForget(target, refs), d)).rejects.toMatchObject({ name: "NeonDbError" });
    for (const f of [d.deleteTodo, d.deleteFact, d.trashNotionPage, d.deleteBlob]) f.mockRejectedValue(httpError(404));
    const log = await executeForget(planForget(target, refs), d);
    expect(log.filter((l) => l.startsWith("already gone"))).toHaveLength(5);
    expect(log.at(-1)).toBe("deleted postgres rec 42");
  });
});

const plan: ForgetPlan = {
  target: { type: "rec", id: 42 },
  resolved: { type: "rec", id: 42 },
  exists: true,
  deletes: { recommendations: 1, rec_receipts: 1, photos: 1, links: 2, space_items: 0, bee_sync: 2, resort_backup: 1, recommenders: 1 },
  updates: {},
  refs: { beeTodoIds: [10, 11], beeFactIds: [5], notionPageIds: ["pg1"], blobUrls: ["https://blob.test/maria-thumb.jpg"] },
  recommender: { id: 9, firstName: "Maria", removed: true },
  notes: [],
};

describe("formatPlan", () => {
  it("prints ids and table counts only: no recommender name, no thumbnail URL", () => {
    const out = formatPlan(plan).join("\n");
    expect(out).toContain("rec 42");
    expect(out).toContain("recommendations 1");
    expect(out).toContain("recommenders 1");
    expect(out).toContain("bee_todo 10, 11");
    expect(out).toContain("notion_page pg1");
    expect(out).toContain("blob 1");
    expect(out).not.toContain("Maria");
    expect(out).not.toContain("maria-thumb");
    expect(out).not.toMatch(/\b0\b/); // tables with nothing to delete are left out
  });

  it("names the idea when a mention is its idea's last", () => {
    const out = formatPlan({ ...plan, target: { type: "mention", id: 8 }, resolved: { type: "idea", id: 3 }, recommender: null });
    expect(out[0]).toContain("mention 8 is the last mention of idea 3");
  });

  it("prints the plan's notes", () => {
    const out = formatPlan({ ...plan, notes: ["title came from this mention: forget the whole idea, or it will be retitled"] });
    expect(out).toContain("  note: title came from this mention: forget the whole idea, or it will be retitled");
  });

  it("says when there is nothing to forget", () => {
    expect(formatPlan({ ...plan, exists: false })).toEqual(["nothing to forget for rec 42"]);
  });
});

describe("trashNotionPage", () => {
  it("moves the page to Trash with the 2026-03-11 API", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    await trashNotionPage("pg1", { token: "t", fetchImpl: fetchImpl as unknown as typeof fetch });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.notion.com/v1/pages/pg1");
    expect(init.method).toBe("PATCH");
    expect(new Headers(init.headers).get("notion-version")).toBe("2026-03-11");
    expect(JSON.parse(String(init.body))).toEqual({ in_trash: true });
  });

  it("throws with the status so a 404 counts as already gone", async () => {
    const fetchImpl = vi.fn(async () => new Response("gone", { status: 404 }));
    const err = await trashNotionPage("pg1", { token: "t", fetchImpl: fetchImpl as unknown as typeof fetch }).catch((e) => e);
    expect(err).toMatchObject({ name: "NotionApiError", status: 404 });
  });

  it("an already-trashed page is done: 200, or the 400 validation_error Notion sends for an archived page", async () => {
    const archived = { object: "error", status: 400, code: "validation_error", message: "Can't edit block that is archived. You must unarchive the block before editing." };
    for (const res of [new Response(JSON.stringify({ object: "page", in_trash: true }), { status: 200 }), new Response(JSON.stringify(archived), { status: 400 })]) {
      const fetchImpl = vi.fn(async () => res);
      await expect(trashNotionPage("pg1", { token: "t", fetchImpl: fetchImpl as unknown as typeof fetch })).resolves.toBeUndefined();
    }
  });

  it("any other 400 is a real failure, even one that only mentions an archived field", async () => {
    for (const message of ["body failed validation", "body.archived should be not present", "archived_at is not a property"]) {
      const other = { object: "error", status: 400, code: "validation_error", message };
      const fetchImpl = vi.fn(async () => new Response(JSON.stringify(other), { status: 400 }));
      const err = await trashNotionPage("pg1", { token: "t", fetchImpl: fetchImpl as unknown as typeof fetch }).catch((e) => e);
      expect(err, message).toMatchObject({ name: "NotionApiError", status: 400 });
    }
  });
});

describe("parseForgetArgs", () => {
  it("is a dry run unless --yes is given", () => {
    expect(parseForgetArgs(["rec", "42"])).toEqual({ target: { type: "rec", id: 42 }, yes: false });
    expect(parseForgetArgs(["idea", "3", "--dry-run"])).toEqual({ target: { type: "idea", id: 3 }, yes: false });
    expect(parseForgetArgs(["mention", "8", "--yes"])).toEqual({ target: { type: "mention", id: 8 }, yes: true });
  });

  it("refuses anything else", () => {
    for (const argv of [[], ["rec"], ["song", "1"], ["rec", "0"], ["rec", "1.5"], ["rec", "x"], ["rec", "1", "--force"], ["rec", "1", "--yes", "--dry-run"]]) {
      expect(() => parseForgetArgs(argv), argv.join(" ")).toThrow(/usage/);
    }
  });
});
