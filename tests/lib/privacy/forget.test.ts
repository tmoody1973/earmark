import { describe, expect, it, vi } from "vitest";
import {
  executeExternal, formatPlan, planExternal, trashNotionPage, type ExternalDeps, type ForgetPlan,
} from "../../../agent/lib/privacy/forget";
import { parseForgetArgs } from "../../../scripts/forget";

// Adapted from PostHog draft PR #8; external deletes now run after the Postgres commit (decision 011).
const plan: ForgetPlan = {
  target: { type: "rec", id: 42 },
  resolved: { type: "rec", id: 42 },
  exists: true,
  deletes: { recommendations: 1, rec_receipts: 1, photos: 1, links: 2, space_items: 0, bee_sync: 2, resort_backup: 1, recommenders: 1 },
  updates: {},
  refs: { beeTodoIds: [10, 11], beeFactIds: [5], notionPageIds: ["pg1"], blobUrls: ["https://blob.test/maria-thumb.jpg"] },
  recommender: { id: 9, firstName: "Maria", removed: true },
};

const deps = (): { [K in keyof ExternalDeps]: ReturnType<typeof vi.fn> } => ({
  deleteTodo: vi.fn(async () => {}),
  deleteFact: vi.fn(async () => {}),
  trashNotionPage: vi.fn(async () => {}),
  deleteBlob: vi.fn(async () => {}),
});
const httpError = (status: number, name = "BeeApiError") =>
  Object.assign(new Error(`secret body text ${status}`), { status, name });

describe("planExternal", () => {
  it("lists Bee todos, Bee facts, Notion pages, then thumbnails", () => {
    expect(planExternal(plan.refs).map((s) => s.kind)).toEqual(["bee_todo", "bee_todo", "bee_fact", "notion_page", "blob"]);
  });
  it("plans nothing when there are no outside copies", () => {
    expect(planExternal({ beeTodoIds: [], beeFactIds: [], notionPageIds: [], blobUrls: [] })).toEqual([]);
  });
});

describe("executeExternal", () => {
  it("runs every step and logs each by id", async () => {
    const d = deps();
    const r = await executeExternal(planExternal(plan.refs), d as unknown as ExternalDeps);
    expect(d.deleteTodo.mock.calls).toEqual([[10], [11]]);
    expect(d.deleteFact).toHaveBeenCalledWith(5);
    expect(d.trashNotionPage).toHaveBeenCalledWith("pg1");
    expect(d.deleteBlob).toHaveBeenCalledWith("https://blob.test/maria-thumb.jpg");
    expect(r.incomplete).toBe(0);
    expect(r.lines).toEqual([
      "deleted bee_todo 10", "deleted bee_todo 11", "deleted bee_fact 5", "deleted notion_page pg1", "deleted blob #1",
    ]);
  });

  it("treats 404 as already gone", async () => {
    const d = deps();
    d.deleteTodo.mockRejectedValueOnce(httpError(404));
    const r = await executeExternal(planExternal(plan.refs), d as unknown as ExternalDeps);
    expect(r.lines[0]).toBe("already gone bee_todo 10");
    expect(r.incomplete).toBe(0);
  });

  it("reports a real failure by id and err.name, keeps going, and never prints the error text", async () => {
    const d = deps();
    d.trashNotionPage.mockRejectedValueOnce(httpError(500, "NotionApiError"));
    const r = await executeExternal(planExternal(plan.refs), d as unknown as ExternalDeps);
    expect(r.lines).toContain("FAILED notion_page pg1 error=NotionApiError");
    expect(d.deleteBlob).toHaveBeenCalled();
    expect(r.incomplete).toBe(1);
    expect(r.lines.join("\n")).not.toContain("secret body text");
  });

  it("skips a service that is not configured, says so, and counts it as not done", async () => {
    const d = { ...deps(), trashNotionPage: null, deleteBlob: null };
    const r = await executeExternal(planExternal(plan.refs), d as unknown as ExternalDeps);
    expect(r.lines).toContain("skipped: notion not configured (NOTION_TOKEN) notion_page pg1");
    expect(r.lines).toContain("skipped: blob not configured (BLOB_READ_WRITE_TOKEN) blob #1");
    expect(r.incomplete).toBe(2);
  });
});

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
