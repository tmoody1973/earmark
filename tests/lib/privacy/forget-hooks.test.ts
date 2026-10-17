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
  { id: "4", script_md: "Ann suggested a ramen spot.", audio_url: "https://blob.test/ann-4.mp3" },
  { id: "5", script_md: "Only Annabel and Joanna.", audio_url: "https://blob.test/5.mp3" },
  { id: "6", script_md: "no audio yet, but ann is named", audio_url: null },
];
const RUNS = [
  { id: "7", output_md: "## Pitch\nAnn's ramen tip." },
  { id: "8", output_md: "Nobody named, only Annabel." },
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
const ctx = (c: ReturnType<typeof fakeClient>, firstName: string | null = NAME): ForgetHookContext =>
  ({ c: c as never, target: { type: "rec", id: 1 }, recommenderFirstName: firstName, recommenderRemoved: true });
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
  it("registers gardener_runs and place_nudges before episodes, so the Blob delete is the last thing the transaction does", async () => {
    const { FORGET_HOOKS } = await import("../../../agent/lib/privacy/forget-hooks");
    expect(FORGET_HOOKS.map((h) => h.name)).toEqual(["gardener_runs", "place_nudges", "episodes"]);
  });

  it("place_nudges: deletes the rec's nudge bee_sync rows in the transaction, then their Bee todos; line has ids only", async () => {
    nudgeTodos = [{ bee_id: "99" }, { bee_id: "100" }];
    const c = fakeClient();
    const line = await (await hook("place_nudges")).run(ctx(c));
    expect(line).toBe("place_nudges 2 (bee todos 99, 100)");
    expect(c.query.mock.calls[0]![0].replace(/\s+/g, " ")).toContain("delete from bee_sync where entity_type = 'place_nudge' and entity_id = $1 and bee_object = 'todo'");
    expect(c.query.mock.calls[0]![1]).toEqual([1]);
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

  it("episodes: deletes only episodes naming the person through ctx.c with $n parameters, then their audio last", async () => {
    const c = fakeClient();
    const line = await (await hook("episodes")).run(ctx(c));
    expect(line).toBe("episodes 2 (ids 4, 6), audio 1");
    expect(c.query.mock.calls.map(([text, values]) => [text.replace(/\s+/g, " ").trim(), values])).toEqual([
      ["select id, script_md, audio_url from episodes", []],
      ["delete from episodes where id = $1", [4]],
      ["delete from episodes where id = $1", [6]],
    ]);
    expect(log.at(-1)).toBe("blob https://blob.test/ann-4.mp3");
    expect(blob.del).toHaveBeenCalledTimes(1);
  });

  it("episodes: an audio file that is already gone (404 / not found) counts as done", async () => {
    const { BlobNotFoundError } = await import("@vercel/blob");
    blob.del.mockRejectedValueOnce(new (BlobNotFoundError as unknown as new () => Error)());
    expect(await (await hook("episodes")).run(ctx(fakeClient()))).toBe("episodes 2 (ids 4, 6), audio 1");
    blob.del.mockRejectedValueOnce(Object.assign(new Error("gone"), { status: 404 }));
    expect(await (await hook("episodes")).run(ctx(fakeClient()))).toBe("episodes 2 (ids 4, 6), audio 1");
  });

  it("episodes: any other Blob failure throws (lane A rolls the rows back, a re-run retries)", async () => {
    blob.del.mockRejectedValueOnce(Object.assign(new Error("blob down"), { status: 503 }));
    await expect((await hook("episodes")).run(ctx(fakeClient()))).rejects.toThrow("blob down");
  });

  it("episodes: a DB error propagates and no audio is deleted", async () => {
    await expect((await hook("episodes")).run(ctx(fakeClient(/delete from episodes/)))).rejects.toMatchObject({ name: "NeonDbError" });
    expect(blob.del).not.toHaveBeenCalled();
  });

  it("gardener_runs: deletes only drafts naming the person through ctx.c", async () => {
    const c = fakeClient();
    expect(await (await hook("gardener_runs")).run(ctx(c))).toBe("gardener_runs 1 (ids 7)");
    expect(c.query.mock.calls.map(([text, values]) => [text.replace(/\s+/g, " ").trim(), values])).toEqual([
      ["select id, output_md from gardener_runs", []],
      ["delete from gardener_runs where id = $1", [7]],
    ]);
  });

  it("gardener_runs: a DB error propagates", async () => {
    await expect((await hook("gardener_runs")).run(ctx(fakeClient(/gardener_runs/)))).rejects.toMatchObject({ name: "NeonDbError" });
  });

  it("without a recommender first name both hooks touch nothing and say 0", async () => {
    const c = fakeClient();
    expect(await (await hook("episodes")).run(ctx(c, null))).toBe("episodes 0");
    expect(await (await hook("gardener_runs")).run(ctx(c, null))).toBe("gardener_runs 0");
    expect(c.query).not.toHaveBeenCalled();
    expect(blob.del).not.toHaveBeenCalled();
  });

  it("output lines carry ids and counts only, never the name, script text or audio URL", async () => {
    const lines = [await (await hook("gardener_runs")).run(ctx(fakeClient())), await (await hook("episodes")).run(ctx(fakeClient()))];
    for (const l of lines) expect(l).toMatch(/^[a-z_]+ \d+( \(ids [\d, ]+\))?(, audio \d+)?$/);
    expect(lines.join(" ")).not.toMatch(/ann|ramen|blob/i);
  });
});
