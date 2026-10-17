import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ForgetHookContext } from "../../../agent/lib/privacy/forget";

// Lane C's hooks inside lane A's forget transaction: every query goes through ctx.c, Blob audio goes last.
const log: string[] = [];
const blob = vi.hoisted(() => ({ del: vi.fn<(url: string) => Promise<void>>() }));
vi.mock("@vercel/blob", () => {
  class BlobNotFoundError extends Error {}
  return { del: blob.del, BlobNotFoundError };
});

const bee = vi.hoisted(() => ({ deleteTodo: vi.fn<(id: number) => Promise<void>>() }));
vi.mock("../../../agent/lib/bee/client", async (orig) => ({
  ...(await orig<typeof import("../../../agent/lib/bee/client")>()),
  createBeeClient: () => ({ deleteTodo: bee.deleteTodo }),
}));

const NAME = "Ann";
let nudgeTodos: { bee_id: string }[] = [];
const EPISODES = [
  { id: "4", week_of: "2026-10-04", script_md: "Ann suggested a ramen spot.", audio_url: "https://blob.test/ann-4.mp3" },
  { id: "5", week_of: "2026-10-11", script_md: "Only Annabel and Joanna.", audio_url: "https://blob.test/5.mp3" },
  { id: "6", week_of: "2026-09-27", script_md: "no audio yet, but ann is named", audio_url: null },
];
const RUNS = [
  { id: "7", output_md: "## Pitch\nAnn's ramen tip.", status: "approved", created_at: new Date("2026-10-10T12:00:00Z") },
  { id: "8", output_md: "Nobody named, only Annabel.", status: "draft", created_at: new Date("2026-10-13T12:00:00Z") },
];

function fakeClient(fail?: RegExp) {
  return {
    query: vi.fn(async (text: string, values: unknown[] = []) => {
      log.push(`db ${text.trim().split(/\s+/).slice(0, 3).join(" ")} ${JSON.stringify(values)}`);
      if (fail?.test(text)) throw Object.assign(new Error("db down"), { name: "NeonDbError" });
      if (/from episodes/.test(text)) return { rows: EPISODES };
      if (/from gardener_runs/.test(text)) return { rows: RUNS };
      if (/from bee_sync/.test(text)) return { rows: nudgeTodos };
      return { rows: [] };
    }),
  };
}
const ctx = (c: ReturnType<typeof fakeClient>, firstName: string | null = NAME, savedAt: Date | null = null): ForgetHookContext =>
  ({ c: c as never, target: { type: "rec", id: 1 }, recommenderFirstName: firstName, recommenderRemoved: true, savedAt });
const hook = async (name: string) => {
  const { FORGET_HOOKS } = await import("../../../agent/lib/privacy/forget-hooks");
  const h = FORGET_HOOKS.find((x) => x.name === name);
  if (!h) throw new Error(`no hook ${name}`);
  return h;
};

beforeEach(() => {
  log.length = 0;
  nudgeTodos = [];
  bee.deleteTodo.mockReset();
  bee.deleteTodo.mockImplementation(async (id) => { log.push(`bee todo ${id}`); });
  blob.del.mockReset();
  blob.del.mockImplementation(async (url) => { log.push(`blob ${url}`); });
});

describe("FORGET_HOOKS (lane C)", () => {
  it("registers place_nudges and rec_receipts before episodes_and_drafts, so the Blob delete is the last thing the transaction does", async () => {
    const { FORGET_HOOKS } = await import("../../../agent/lib/privacy/forget-hooks");
    expect(FORGET_HOOKS.map((h) => h.name)).toEqual(["place_nudges", "rec_receipts", "episodes_and_drafts"]);
  });

  it("place_nudges: deletes the orphaned nudge bee_sync rows (every day's) in the transaction, then their Bee todos; line has ids only", async () => {
    nudgeTodos = [{ bee_id: "99" }, { bee_id: "100" }];
    const c = fakeClient();
    const line = await (await hook("place_nudges")).run(ctx(c));
    expect(line).toBe("place_nudges 2 (bee todos 99, 100)");
    expect(c.query.mock.calls[0]![0].replace(/\s+/g, " ")).toContain("not exists (select 1 from place_nudges n where n.id = s.entity_id)");
    expect(c.query.mock.calls[0]![0]).toContain("s.entity_type = 'place_nudge'");
    expect(c.query.mock.calls[0]![1]).toEqual([]);
    expect(log.filter((l) => l.startsWith("bee todo"))).toEqual(["bee todo 99", "bee todo 100"]);
  });

  it("place_nudges: only a rec target; anything else is 0 and touches nothing", async () => {
    const c = fakeClient();
    const idea = { ...ctx(c), target: { type: "idea", id: 1 } } as ForgetHookContext;
    expect(await (await hook("place_nudges")).run(idea)).toBe("place_nudges 0");
    expect(c.query).not.toHaveBeenCalled();
    expect(bee.deleteTodo).not.toHaveBeenCalled();
  });

  it("place_nudges: a Bee 404 counts as already gone; any other failure throws so the forget rolls back", async () => {
    const { BeeApiError } = await import("../../../agent/lib/bee/client");
    nudgeTodos = [{ bee_id: "99" }];
    bee.deleteTodo.mockRejectedValueOnce(new BeeApiError(404, "/v1/todos/99", "gone"));
    expect(await (await hook("place_nudges")).run(ctx(fakeClient()))).toBe("place_nudges 1 (bee todos 99)");
    bee.deleteTodo.mockRejectedValueOnce(new BeeApiError(503, "/v1/todos/99", "down"));
    await expect((await hook("place_nudges")).run(ctx(fakeClient()))).rejects.toThrow("Bee API 503");
  });

  it("rec_receipts: deletes the orphaned receipt bee_sync rows in the transaction, then their Bee todos; line has ids only", async () => {
    nudgeTodos = [{ bee_id: "55" }];
    const c = fakeClient();
    const line = await (await hook("rec_receipts")).run(ctx(c));
    expect(line).toBe("rec_receipts 1 (bee todos 55)");
    const q = c.query.mock.calls[0]![0].replace(/\s+/g, " ");
    expect(q).toContain("not exists (select 1 from rec_receipts n where n.id = s.entity_id)");
    expect(q).toContain("s.entity_type = 'rec_receipt'");
    expect(c.query.mock.calls[0]![1]).toEqual([]);
    expect(log.filter((l) => l.startsWith("bee todo"))).toEqual(["bee todo 55"]);
  });

  it("rec_receipts: only a rec target; a Bee 404 is already gone; any other failure throws", async () => {
    const { BeeApiError } = await import("../../../agent/lib/bee/client");
    const c0 = fakeClient();
    expect(await (await hook("rec_receipts")).run({ ...ctx(c0), target: { type: "idea", id: 1 } } as ForgetHookContext)).toBe("rec_receipts 0");
    expect(c0.query).not.toHaveBeenCalled();
    nudgeTodos = [{ bee_id: "55" }];
    bee.deleteTodo.mockRejectedValueOnce(new BeeApiError(404, "/v1/todos/55", "gone"));
    expect(await (await hook("rec_receipts")).run(ctx(fakeClient()))).toBe("rec_receipts 1 (bee todos 55)");
    bee.deleteTodo.mockRejectedValueOnce(new BeeApiError(503, "/v1/todos/55", "down"));
    await expect((await hook("rec_receipts")).run(ctx(fakeClient()))).rejects.toThrow("Bee API 503");
  });

  // Monday 2026-10-12 10:00 Chicago -> the week of Sunday 2026-10-11
  const SAVED = new Date("2026-10-12T15:00:00Z");
  const SWEEP = "3 episodes (weeks 2026-09-27–2026-10-11) and 2 drafts, including 1 awaiting approval";

  it("episodes_and_drafts: through ctx.c with $n parameters, drafts then episodes, audio last; the line has counts, weeks and ids only", async () => {
    const c = fakeClient();
    expect(await (await hook("episodes_and_drafts")).run(ctx(c, NAME, SAVED)))
      .toBe(`deleted ${SWEEP}; audio 2 (episode ids 4, 5, 6; draft ids 7, 8)`);
    expect(c.query.mock.calls.map(([text, values]) => [text.replace(/\s+/g, " ").trim(), values])).toEqual([
      ["select id, week_of::text as week_of, script_md, audio_url from episodes", []],
      ["select id, output_md, status, created_at from gardener_runs", []],
      ["delete from gardener_runs where id = $1", [7]],
      ["delete from gardener_runs where id = $1", [8]],
      ["delete from episodes where id = $1", [4]],
      ["delete from episodes where id = $1", [5]],
      ["delete from episodes where id = $1", [6]],
    ]);
    expect(log.slice(-2)).toEqual(["blob https://blob.test/ann-4.mp3", "blob https://blob.test/5.mp3"]);
  });

  it("episodes_and_drafts preview (the dry run): the same counts, reads only, deletes nothing", async () => {
    const c = fakeClient();
    expect(await (await hook("episodes_and_drafts")).preview!(ctx(c, NAME, SAVED))).toBe(`will also delete ${SWEEP}`);
    expect(c.query.mock.calls.every(([text]) => text.trim().startsWith("select"))).toBe(true);
    expect(blob.del).not.toHaveBeenCalled();
  });

  it("an item with no recommender (an idea): every episode from its save week and every draft after it, named or not", async () => {
    const idea = { ...ctx(fakeClient(), null, SAVED), target: { type: "idea", id: 3 } } as ForgetHookContext;
    expect(await (await hook("episodes_and_drafts")).run(idea))
      .toBe("deleted 1 episode (week 2026-10-11) and 1 draft, including 1 awaiting approval; audio 1 (episode ids 5; draft ids 8)");
  });

  it("an audio file that is already gone (404 / not found) counts as done; any other Blob failure throws", async () => {
    const { BlobNotFoundError } = await import("@vercel/blob");
    blob.del.mockRejectedValueOnce(new (BlobNotFoundError as unknown as new () => Error)());
    expect(await (await hook("episodes_and_drafts")).run(ctx(fakeClient()))).toContain("audio 1");
    blob.del.mockRejectedValueOnce(Object.assign(new Error("blob down"), { status: 503 }));
    await expect((await hook("episodes_and_drafts")).run(ctx(fakeClient()))).rejects.toThrow("blob down");
  });

  it("a DB error propagates and no audio is deleted", async () => {
    await expect((await hook("episodes_and_drafts")).run(ctx(fakeClient(/delete from episodes/)))).rejects.toMatchObject({ name: "NeonDbError" });
    expect(blob.del).not.toHaveBeenCalled();
  });

  it("with neither a name nor a save time it touches nothing and says 0", async () => {
    const c = fakeClient();
    expect(await (await hook("episodes_and_drafts")).run(ctx(c, null))).toBe("deleted 0 episodes and 0 drafts, including 0 awaiting approval; audio 0");
    expect(c.query).not.toHaveBeenCalled();
  });

  it("output lines never carry the name, script text or audio URL", async () => {
    const h = await hook("episodes_and_drafts");
    const lines = [await h.run(ctx(fakeClient(), NAME, SAVED)), await h.preview!(ctx(fakeClient(), NAME, SAVED))];
    expect(lines.join(" ")).not.toMatch(/ann|ramen|blob|pitch/i);
  });
});
