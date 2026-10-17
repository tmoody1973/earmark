import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool, type PoolClient } from "@neondatabase/serverless";
import { BeeApiError } from "../../agent/lib/bee/client";

// Real Neon `test` branch (TEST_DATABASE_URL, never production) with a FAKE Bee: no request reaches Bee. Only this
// file's rows are touched (ids tracked, deleted after); onlyIds keeps the reconciler off every other row.
describe.skipIf(!process.env.TEST_DATABASE_URL)("Bee todo reconciler on the Neon test branch (M3-T7)", () => {
  let pool: Pool;
  let c: PoolClient;
  const ids: number[] = [];
  const mod = () => import("../../agent/lib/sync/bee-todos");
  const env = { BEE_TODO_WRITES: "on", EARMARK_PUBLIC_BASE_URL: "https://earmark.test" };

  type T = { id: number; text: string; completed: boolean; alarm_at: null };
  function fakeBee(seed: Omit<T, "id" | "alarm_at">[] = []) {
    const todos = new Map<number, T>();
    let next = 9_000_000 + Math.floor(Math.random() * 1_000_000);
    const add = (t: Omit<T, "id" | "alarm_at">) => { const id = next++; todos.set(id, { id, alarm_at: null, ...t }); return id; };
    seed.forEach(add);
    const gone = (id: number) => new BeeApiError(404, `/v1/todos/${id}`, "not found");
    return {
      todos, add,
      listTodos: vi.fn(async () => ({ todos: [...todos.values()], next_cursor: null })),
      createTodo: vi.fn(async ({ text }: { text: string }) => ({ id: add({ text, completed: false }) })),
      updateTodo: vi.fn(async (id: number, patch: { text?: string; completed?: boolean }) => {
        const t = todos.get(id);
        if (!t) throw gone(id);
        todos.set(id, { ...t, ...patch });
      }),
      deleteTodo: vi.fn(async (id: number) => { if (!todos.delete(id)) throw gone(id); }),
    };
  }

  const addRec = async (status: string, name = "IT todo") => {
    const { rows } = await c.query(
      `insert into recommendations (type, raw_text, canonical_name, creator, excerpt, said_at, source, status, confidence)
       values ('album', 'it todo', $2, 'IT Band', 'SECRET EXCERPT', '2026-10-12T18:00:00Z', 'ambient', $1, 0.9) returning id`,
      [status, name]);
    ids.push(Number(rows[0].id));
    return Number(rows[0].id);
  };
  const rec = async (id: number) => (await c.query(`select status, bee_todo_id from recommendations where id = $1`, [id])).rows[0];
  const sync = async (id: number) => (await c.query(
    `select bee_id, last_written_state from bee_sync where entity_type = 'rec' and entity_id = $1 and bee_object = 'todo'`, [id])).rows[0];
  const setStatus = (id: number, s: string) => c.query(`update recommendations set status = $2 where id = $1`, [id, s]);
  const drain = async (bee: ReturnType<typeof fakeBee>, onlyIds: number[]) => (await mod()).drainTodoQueue({ bee, env, onlyIds });

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    c = await pool.connect();
  });
  beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });
  afterAll(async () => {
    if (!c) return;
    await c.query(`delete from bee_sync where entity_type = 'rec' and entity_id = any($1::bigint[])`, [ids]);
    await c.query(`delete from recommendations where id = any($1::bigint[])`, [ids]);
    c.release();
    await pool.end();
  });

  it("turns queued tips into Earmark todos, saves the Bee id after Bee succeeds, and a re-run writes nothing", async () => {
    const a = await addRec("queued", "IT Alpha");
    const bee = fakeBee();
    expect(await drain(bee, [a])).toMatchObject({ status: "done", created: 1 });
    const { bee_todo_id } = await rec(a);
    const text = bee.todos.get(Number(bee_todo_id))!.text;
    expect(text).toBe(`Earmark · Listen: IT Alpha, IT Band (Oct 12) https://earmark.test/shelf#rec-${a}`);
    expect(text).not.toContain("SECRET");
    expect(await sync(a)).toEqual({ bee_id: bee_todo_id, last_written_state: { text, completed: false } });

    expect(await drain(bee, [a])).toMatchObject({ status: "done", created: 0, completed: 0, removed: 0 });
    expect(bee.createTodo).toHaveBeenCalledTimes(1);
  });

  it("caps open Earmark todos at 10, counted from Bee itself (other todos don't count)", async () => {
    const recs = [await addRec("queued"), await addRec("queued"), await addRec("queued")];
    const bee = fakeBee([
      ...Array.from({ length: 8 }, (_, i) => ({ text: `Earmark · Listen: old ${i}`, completed: false })),
      { text: "Earmark · Listen: done one", completed: true },
      { text: "Call the dentist", completed: false },
    ]);
    expect(await drain(bee, recs)).toMatchObject({ created: 2 });
    expect((await Promise.all(recs.map(rec))).filter((r) => r.bee_todo_id !== null)).toHaveLength(2);
    expect(await drain(bee, recs)).toMatchObject({ created: 0 }); // full: the third waits for a free slot
  });

  it("completes the todo when a tip is tried and deletes it when dismissed; a todo already gone (404) is fine", async () => {
    const tried = await addRec("queued");
    const dismissed = await addRec("queued");
    const vanished = await addRec("queued");
    const bee = fakeBee();
    await drain(bee, [tried, dismissed, vanished]);
    const [t, d, v] = await Promise.all([tried, dismissed, vanished].map(async (id) => Number((await rec(id)).bee_todo_id)));
    await setStatus(tried, "tried");
    await setStatus(dismissed, "dismissed");
    await setStatus(vanished, "new");
    bee.todos.delete(v); // Tarik deleted it in the Bee app

    expect(await drain(bee, [tried, dismissed, vanished])).toMatchObject({ completed: 1, removed: 2 });
    expect(bee.todos.get(t)!.completed).toBe(true);
    expect(bee.todos.has(d)).toBe(false);
    expect(bee.updateTodo).toHaveBeenCalledTimes(1);
    expect(bee.deleteTodo).toHaveBeenCalledTimes(1); // the vanished one is absent from Bee's full list: no call
    expect((await rec(tried)).bee_todo_id).toBeNull();
    expect((await sync(tried)).last_written_state).toMatchObject({ completed: true }); // kept: forget still finds it
    expect(await sync(dismissed)).toBeUndefined();
    expect(await sync(vanished)).toBeUndefined();
  });

  it("crash between create and save: the next run adopts the todo with the same text instead of creating a twin", async () => {
    const a = await addRec("queued", "IT Crash");
    const bee = fakeBee();
    const orphan = bee.add({ text: `Earmark · Listen: IT Crash, IT Band (Oct 12) https://earmark.test/shelf#rec-${a}`, completed: false });
    expect(await drain(bee, [a])).toMatchObject({ created: 0, adopted: 1 });
    expect(bee.createTodo).not.toHaveBeenCalled();
    expect(Number((await rec(a)).bee_todo_id)).toBe(orphan);
  });

  it("a Bee failure saves nothing and stops the run; the next run creates exactly once", async () => {
    const a = await addRec("queued");
    const b = await addRec("queued");
    const bee = fakeBee();
    bee.createTodo.mockRejectedValueOnce(new BeeApiError(500, "/v1/todos", "boom"));
    expect(await drain(bee, [a, b])).toMatchObject({ created: 0, failed: true });
    expect(bee.createTodo).toHaveBeenCalledTimes(1);
    expect((await rec(a)).bee_todo_id).toBeNull();
    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/^\[bee-todos\] create failed rec=\d+ error=BeeApiError$/));
    expect(await drain(bee, [a, b])).toMatchObject({ created: 2, failed: false });
    expect(bee.todos.size).toBe(2);
  });

  it("a tip that left 'queued' while its todo was being made gets that todo deleted, not orphaned", async () => {
    const a = await addRec("queued");
    const bee = fakeBee();
    const create = bee.createTodo.getMockImplementation()!;
    bee.createTodo.mockImplementationOnce(async (input) => { await setStatus(a, "dismissed"); return create(input); });
    expect(await drain(bee, [a])).toMatchObject({ created: 0 });
    expect(bee.todos.size).toBe(0);
    expect((await rec(a)).bee_todo_id).toBeNull();
  });

  it("re-queueing a tried tip reopens its old todo instead of making a second one", async () => {
    const a = await addRec("queued");
    const bee = fakeBee();
    await drain(bee, [a]);
    const first = Number((await rec(a)).bee_todo_id);
    await setStatus(a, "tried");
    await drain(bee, [a]);
    await setStatus(a, "queued");
    expect(await drain(bee, [a])).toMatchObject({ created: 1 }); // counted as a slot taken
    expect(Number((await rec(a)).bee_todo_id)).toBe(first);
    expect(bee.todos.get(first)!.completed).toBe(false);
    expect(bee.createTodo).toHaveBeenCalledTimes(1);
  });

  it("never makes more than MAX_WRITES_PER_RUN Bee writes in one run", async () => {
    const { MAX_WRITES_PER_RUN } = await mod();
    const recs = await Promise.all(Array.from({ length: MAX_WRITES_PER_RUN + 2 }, () => addRec("queued")));
    const bee = fakeBee();
    for (const id of recs) {
      const todo = bee.add({ text: "Earmark · Listen: tracked", completed: false });
      await c.query(`update recommendations set bee_todo_id = $2, status = 'dismissed' where id = $1`, [id, todo]);
    }
    expect(await drain(bee, recs)).toMatchObject({ removed: MAX_WRITES_PER_RUN });
    expect(bee.deleteTodo).toHaveBeenCalledTimes(MAX_WRITES_PER_RUN);
    expect(await drain(bee, recs)).toMatchObject({ removed: 2 });
  });
});
