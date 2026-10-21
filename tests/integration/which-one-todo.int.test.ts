import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool, type PoolClient } from "@neondatabase/serverless";
import { BeeApiError } from "../../agent/lib/bee/client";
import { describeCandidate } from "../../agent/lib/enrich/match";

// "Is this the one?" on the wrist (decision 062) on the Neon `test` branch (TEST_DATABASE_URL, never production) with a
// FAKE Bee: no request reaches Bee. Sweeps and todo passes are scoped to this file's rows (onlyIds).
const AT = "2026-10-01T15:00:00Z";
const ON = { BEE_TODO_WRITES: "on", EARMARK_PUBLIC_BASE_URL: "https://earmark.test" };
const SECRET = "SECRET EXCERPT Ann said it";
const cand = (name: string) => ({
  provider: "openlibrary", canonicalName: name, creator: "Mara Vell", yearOrAddress: "2021", imageUrl: null,
  links: { openlibrary: `https://openlibrary.org/works/${name.replace(/\W/g, "")}` },
});
const A = cand("Night Garden");
const B = cand("Night Garden: Stories");

type T = { id: number; text: string; completed: boolean; alarm_at: null };
function fakeBee(seedOpen = 0) {
  const todos = new Map<number, T>();
  let next = 9_000_000 + Math.floor(Math.random() * 1_000_000);
  const add = (t: Omit<T, "id" | "alarm_at">) => { const id = next++; todos.set(id, { id, alarm_at: null, ...t }); return id; };
  for (let i = 0; i < seedOpen; i++) add({ text: `Earmark · seed ${i}`, completed: false });
  const gone = (id: number) => new BeeApiError(404, `/v1/todos/${id}`, "not found");
  return {
    todos,
    listTodos: vi.fn(async () => ({ todos: [...todos.values()], next_cursor: null })),
    createTodo: vi.fn(async ({ text }: { text: string }) => ({ id: add({ text, completed: false }) })),
    updateTodo: vi.fn(async (id: number, patch: { text?: string; completed?: boolean }) => {
      const t = todos.get(id);
      if (!t) throw gone(id);
      todos.set(id, { ...t, ...patch });
    }),
    deleteTodo: vi.fn(async (id: number) => { if (!todos.delete(id)) throw gone(id); }),
    getTodo: vi.fn(async (id: number) => { const t = todos.get(id); if (!t) throw gone(id); return t; }),
  };
}

describe.skipIf(!process.env.TEST_DATABASE_URL)("Which one? on the wrist (decision 062)", () => {
  let pool: Pool;
  let c: PoolClient;
  const ids: number[] = [];
  const quiet = { summarize: vi.fn(async () => null), beeSummary: vi.fn(async () => null), embedRecs: vi.fn(async () => 0),
    about: vi.fn(async () => null), extras: vi.fn(async () => ({})) };
  const sweep = async (id: number, bee: ReturnType<typeof fakeBee>, env: Record<string, string> = ON) =>
    (await import("../../agent/lib/recs/lane")).sweepRecLane({ ...quiet, env, bee, onlyIds: [id] });
  const todoRows = async (id: number) => (await c.query(
    `select bee_id, last_written_state from bee_sync where entity_type = 'which_one' and entity_id = $1 and bee_object = 'todo'`, [id])).rows;

  // A tip the lane left asking "Which one?": automatic, final no_match, options kept (candidates_at <= enriched_at).
  const addAsking = async (o: { status?: string; candidates?: unknown[] } = {}) => {
    const { rows } = await c.query(
      `insert into recommendations (type, raw_text, canonical_name, excerpt, said_at, source, status, confidence,
         enrichment_status, match_source, match_candidates, candidates_at, enriched_at)
       values ('book', $4, 'IT wrist', $4, $1, 'ambient', $2, 0.9, 'no_match', 'auto', $3::jsonb, now() - interval '2 minutes', now() - interval '1 minute')
       returning id`,
      [AT, o.status ?? "needs_review", JSON.stringify(o.candidates ?? [A, B]), SECRET]);
    ids.push(Number(rows[0].id));
    return Number(rows[0].id);
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    c = await pool.connect();
  });
  afterAll(async () => {
    if (!c) return;
    await c.query(`delete from bee_sync where entity_type = 'which_one' and entity_id = any($1::bigint[])`, [ids]);
    await c.query(`delete from recommendations where id = any($1::bigint[])`, [ids]);
    await c.query(`delete from sync_cursors where name = 'rec_lane_lease'`);
    c.release();
    await pool.end();
  });

  it("makes exactly one todo for a Which one? tip, with derived words only, and a second pass makes none", async () => {
    const id = await addAsking();
    const bee = fakeBee();
    expect(await sweep(id, bee)).toMatchObject({ status: "done", wristAsks: 1 });
    expect(bee.createTodo).toHaveBeenCalledTimes(1);
    expect(bee.createTodo).toHaveBeenCalledWith({ text: `Earmark · Is this Night Garden? Confirm in Earmark https://earmark.test/tips/${id}`, alarmAt: null });
    expect(JSON.stringify(bee.createTodo.mock.calls)).not.toContain("SECRET");
    expect(await sweep(id, bee)).toMatchObject({ wristAsks: 0 });
    expect(bee.createTodo).toHaveBeenCalledTimes(1);
    expect(await todoRows(id)).toHaveLength(1);
  });

  it("changed options refresh the same todo in place, never a second one", async () => {
    const id = await addAsking();
    const bee = fakeBee();
    await sweep(id, bee);
    await c.query(`update recommendations set match_candidates = $2::jsonb where id = $1`, [id, JSON.stringify([B, A])]);
    expect(await sweep(id, bee)).toMatchObject({ wristAsks: 1 });
    expect(bee.createTodo).toHaveBeenCalledTimes(1);
    expect(bee.updateTodo).toHaveBeenCalledWith(expect.any(Number), expect.objectContaining({ text: expect.stringContaining("Is this Night Garden: Stories?") }));
    expect(await todoRows(id)).toHaveLength(1);
  });

  it("makes none for the owner's own Search again", async () => {
    const id = await addAsking({ candidates: [] });
    const { searchAgain } = await import("../../agent/lib/recs/which-one");
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ docs: [{ key: "/works/OL1W", title: "Night Garden", author_name: ["Mara Vell"], first_publish_year: 2001 }] }),
      { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    expect(await searchAgain(id, "night garden", { env: {}, fetchImpl })).toMatchObject({ status: "ok", found: 1 });
    const bee = fakeBee();
    expect(await sweep(id, bee)).toMatchObject({ wristAsks: 0 });
    expect(bee.createTodo).not.toHaveBeenCalled();
    expect(await todoRows(id)).toHaveLength(0);
  });

  it("picking an option completes the todo", async () => {
    const id = await addAsking();
    const bee = fakeBee();
    await sweep(id, bee);
    const { pickCandidate } = await import("../../agent/lib/recs/which-one");
    expect(await pickCandidate(id, 0, describeCandidate(A), {}, { bee, env: ON })).toEqual({ changed: true });
    const [{ bee_id, last_written_state }] = await todoRows(id);
    expect(bee.todos.get(Number(bee_id))?.completed).toBe(true);
    expect(last_written_state).toMatchObject({ completed: true });
    expect(await sweep(id, bee)).toMatchObject({ wristAsks: 0 }); // answered and done: still just the one, ever
    expect(bee.createTodo).toHaveBeenCalledTimes(1);
  });

  it("None of these completes the todo", async () => {
    const id = await addAsking();
    const bee = fakeBee();
    await sweep(id, bee);
    const { noneOfThese } = await import("../../agent/lib/recs/which-one");
    expect(await noneOfThese(id, { bee, env: ON })).toEqual({ changed: true });
    const [{ bee_id }] = await todoRows(id);
    expect(bee.todos.get(Number(bee_id))?.completed).toBe(true);
  });

  it("a dismissed tip's todo is completed by the next lane pass (the backstop)", async () => {
    const id = await addAsking();
    const bee = fakeBee();
    await sweep(id, bee);
    await c.query(`update recommendations set status = 'dismissed' where id = $1`, [id]);
    await sweep(id, bee);
    const [{ bee_id }] = await todoRows(id);
    expect(bee.todos.get(Number(bee_id))?.completed).toBe(true);
  });

  it("writes off: no todo, no error, the tip is unaffected", async () => {
    const id = await addAsking();
    const bee = fakeBee();
    expect(await sweep(id, bee, {})).toMatchObject({ status: "done", wristAsks: 0 });
    expect(bee.listTodos).not.toHaveBeenCalled();
    expect(bee.createTodo).not.toHaveBeenCalled();
    const { rows } = await c.query(`select enrichment_status, match_source from recommendations where id = $1`, [id]);
    expect(rows[0]).toEqual({ enrichment_status: "no_match", match_source: "auto" });
  });

  it("cap reached: skipped quietly, the lane result is unaffected, and the next pass tries again", async () => {
    const id = await addAsking();
    const full = fakeBee(10);
    expect(await sweep(id, full)).toMatchObject({ status: "done", wristAsks: 0 });
    expect(full.createTodo).not.toHaveBeenCalled();
    expect(await todoRows(id)).toHaveLength(0);
    const roomy = fakeBee();
    expect(await sweep(id, roomy)).toMatchObject({ wristAsks: 1 });
  });

  it("a Bee error never fails the lane", async () => {
    const id = await addAsking();
    const bee = fakeBee();
    bee.listTodos.mockRejectedValueOnce(new Error("bee down"));
    expect(await sweep(id, bee)).toMatchObject({ status: "done", wristAsks: 0 });
  });

  it("a matched tip, or one with no options, gets no todo", async () => {
    const matched = await addAsking();
    await c.query(`update recommendations set enrichment_status = 'matched' where id = $1`, [matched]);
    const empty = await addAsking({ candidates: [] });
    const bee = fakeBee();
    await sweep(matched, bee);
    await sweep(empty, bee);
    expect(bee.createTodo).not.toHaveBeenCalled();
  });
});
