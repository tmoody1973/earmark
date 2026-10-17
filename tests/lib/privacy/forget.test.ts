import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeMockDb } from "../../helpers/mock-db";

const mock = vi.hoisted(() => ({ current: undefined as ReturnType<typeof makeMockDb> | undefined }));
vi.mock("../../../agent/lib/db", () => ({ db: () => mock.current!.sql }));

import { deleteRows, executeForget, loadForgetRefs, planForget } from "../../../agent/lib/privacy/forget";
import { createBeeClient } from "../../../agent/lib/bee/client";
import { createNotionClient, NotionApiError, trashNotionPage } from "../../../agent/lib/notion/client";

const refs = { exists: true, beeTodoIds: [10, 11], beeFactIds: [5], notionPageIds: ["pg1"], blobUrls: ["https://blob/t.jpg"] };
const target = { type: "rec" as const, id: 42 };

beforeEach(() => {
  mock.current = makeMockDb();
});

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

  it("runs every step and logs each", async () => {
    const d = deps();
    const log = await executeForget(planForget(target, refs), d);
    expect(d.deleteTodo).toHaveBeenCalledTimes(2);
    expect(d.deleteFact).toHaveBeenCalledWith(5);
    expect(d.trashNotionPage).toHaveBeenCalledWith("pg1");
    expect(d.deleteBlob).toHaveBeenCalledWith("https://blob/t.jpg");
    expect(d.deleteRows).toHaveBeenCalledWith(target);
    expect(log).toHaveLength(6);
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
});

describe("loadForgetRefs", () => {
  it("collects a rec's Bee todos, Notion pages and thumbnails without duplicates", async () => {
    mock.current!.queue.push(
      [{ bee_todo_id: "10", bee_fact_id: null, notion_page_id: "pg1" }],
      [{ bee_object: "todo", bee_id: "10" }, { bee_object: "fact", bee_id: "5" }],
      [{ ok: true }],
      [{ page_id: "pg1" }],
      [{ bee_todo_id: "11" }],
      [{ thumbnail_url: "https://blob/t.jpg" }],
    );
    expect(await loadForgetRefs(target)).toEqual(refs);
  });

  it("reports a missing rec without reading anything else", async () => {
    expect(await loadForgetRefs(target)).toMatchObject({ exists: false });
    expect(mock.current!.calls).toHaveLength(1);
  });

  it("skips notion_sync while that table does not exist", async () => {
    mock.current!.queue.push([{ bee_todo_id: null, bee_fact_id: "7", notion_page_id: null }], [], [{ ok: false }]);
    expect(await loadForgetRefs({ type: "idea", id: 3 })).toEqual({
      exists: true, beeTodoIds: [], beeFactIds: [7], notionPageIds: [], blobUrls: [],
    });
    expect(mock.current!.calls.some((c) => c.text.includes("from notion_sync"))).toBe(false);
  });
});

describe("deleteRows", () => {
  it("deletes a rec's links and Space items (no foreign keys) and drops a recommender left with no recs", async () => {
    mock.current!.queue.push([{ ok: true }], [{ recommender_id: "9" }]);
    await deleteRows(target);
    const texts = mock.current!.calls.map((c) => c.text);
    expect(texts.some((t) => t.includes("delete from links") && t.includes("from_type = ?"))).toBe(true);
    expect(texts.some((t) => t.includes("delete from space_items"))).toBe(true);
    expect(texts.some((t) => t.includes("delete from bee_sync"))).toBe(true);
    expect(texts.some((t) => t.includes("delete from notion_sync"))).toBe(true);
    expect(texts.some((t) => t.includes("delete from recommendations"))).toBe(true);
    expect(texts.some((t) => t.includes("delete from recommenders") && t.includes("not exists"))).toBe(true);
    expect(mock.current!.sql.transaction).toHaveBeenCalledOnce();
  });

  it("removes a mention's timeline line and recomputes its idea", async () => {
    const spokenAt = "2026-10-10T15:00:00.000Z";
    mock.current!.queue.push(
      [{ cluster_id: "3", spoken_at: spokenAt }],
      [{ timeline: [{ date: "2026-10-01T15:00:00.000Z", line: "Oct 1: first" }, { date: spokenAt, line: "Oct 10: second" }] }],
    );
    await deleteRows({ type: "mention", id: 8 });
    const update = mock.current!.calls.at(-1)!;
    expect(update.text).toContain("idea_stage_for");
    expect(update.values).toContain(JSON.stringify([{ date: "2026-10-01T15:00:00.000Z", line: "Oct 1: first" }]));
  });
});

describe("delete clients", () => {
  it("Bee deleteTodo and deleteFact send DELETE and surface the status", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const bee = createBeeClient({ token: "t", baseUrl: "https://bee.test", fetchImpl: fetchImpl as never });
    await bee.deleteTodo(10);
    await bee.deleteFact(5);
    expect(fetchImpl.mock.calls.map((c) => [(c as unknown[])[0], ((c as unknown[])[1] as RequestInit).method])).toEqual([
      ["https://bee.test/v1/todos/10", "DELETE"], ["https://bee.test/v1/facts/5", "DELETE"],
    ]);
    fetchImpl.mockResolvedValueOnce(new Response("not found", { status: 404 }));
    await expect(bee.deleteTodo(10)).rejects.toMatchObject({ status: 404 });
  });

  it("trashNotionPage moves the page to Trash and throws NotionApiError with the status", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    await trashNotionPage("pg1", createNotionClient({ token: "t", fetchImpl: fetchImpl as never }));
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.notion.com/v1/pages/pg1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ in_trash: true });
    fetchImpl.mockResolvedValueOnce(new Response("gone", { status: 404 }));
    const err = await trashNotionPage("pg1", createNotionClient({ token: "t", fetchImpl: fetchImpl as never })).catch((e) => e);
    expect(err).toBeInstanceOf(NotionApiError);
    expect(err.status).toBe(404);
  });
});
