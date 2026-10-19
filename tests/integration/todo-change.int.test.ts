import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool, type PoolClient } from "@neondatabase/serverless";
import { BeeApiError } from "../../agent/lib/bee/client";

// M3-T8 two-way completion sync on the Neon `test` branch (TEST_DATABASE_URL, never production) with a FAKE Bee that
// can only be read: any Bee write would be a missing method. The TEST branch is shared with other lanes, so the lease
// name and the Bee ids are unique to this run, and only this file's rows are touched.
describe.skipIf(!process.env.TEST_DATABASE_URL)("handleTodoChange on the Neon test branch (M3-T8)", () => {
  let pool: Pool;
  let c: PoolClient;
  const ids: number[] = [];
  const beeIds: number[] = [];
  const lease = `todo_change_test_${randomUUID()}`;
  let nextBeeId = 7_000_000_000 + Math.floor(Math.random() * 1_000_000_000);
  const text = "Earmark · Listen: IT Todo Change, IT Band (Oct 12) https://earmark.test/shelf?rec=1";

  type T = { id: number; text: string; completed: boolean; alarm_at: null };
  function fakeBee(todos: T[] = []) {
    const map = new Map(todos.map((t) => [t.id, t]));
    return {
      getTodo: vi.fn(async (id: number) => {
        const t = map.get(id);
        if (!t) throw new BeeApiError(404, `/v1/todos/${id}`, "not found");
        return t;
      }),
    };
  }
  const run = async (beeId: number, bee: ReturnType<typeof fakeBee>) =>
    (await import("../../agent/lib/sync/handlers")).handleTodoChange(beeId, { bee, lease });

  // A tip linked to a Bee todo, as the reconciler leaves it.
  async function linked(status: string, state: { text: string; completed: boolean }, link = true, entityType = "rec") {
    const { rows } = await c.query(
      `insert into recommendations (type, raw_text, canonical_name, creator, excerpt, said_at, source, status, confidence)
       values ('album', 'it todo change', 'IT Todo Change', 'IT Band', 'x', '2026-10-12T18:00:00Z', 'ambient', $1, 0.9)
       returning id`, [status]);
    const recId = Number(rows[0].id);
    ids.push(recId);
    const beeId = nextBeeId++;
    beeIds.push(beeId);
    if (link) await c.query(`update recommendations set bee_todo_id = $2 where id = $1`, [recId, beeId]);
    await c.query(
      `insert into bee_sync (entity_type, entity_id, bee_object, bee_id, last_written_state) values ($1, $2, 'todo', $3, $4)`,
      [entityType, recId, beeId, JSON.stringify(state)]);
    return { recId, beeId };
  }
  const rec = async (id: number) => (await c.query(`select status, bee_todo_id from recommendations where id = $1`, [id])).rows[0];
  const sync = async (beeId: number) =>
    (await c.query(`select entity_id, last_written_state from bee_sync where bee_object = 'todo' and bee_id = $1`, [beeId])).rows[0];
  const todo = (id: number, t: Partial<T> = {}): T => ({ id, text, completed: false, alarm_at: null, ...t });

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    c = await pool.connect();
  });
  beforeEach(() => {
    vi.stubEnv("BEE_TODO_WRITES", "off"); // inbound sync must work with Bee writes off
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterAll(async () => {
    if (!c) return;
    vi.unstubAllEnvs();
    await c.query(`delete from bee_sync where bee_object = 'todo' and bee_id = any($1::bigint[])`, [beeIds]);
    await c.query(`delete from recommendations where id = any($1::bigint[])`, [ids]);
    await c.query(`delete from sync_cursors where name = $1`, [lease]);
    c.release();
    await pool.end();
  });

  it("checking off a queued tip's todo in Bee marks the tip tried and records the completion; a replay changes nothing", async () => {
    const { recId, beeId } = await linked("queued", { text, completed: false });
    const bee = fakeBee([todo(beeId, { completed: true })]);
    await run(beeId, bee);
    expect(await rec(recId)).toEqual({ status: "tried", bee_todo_id: null });
    expect(await sync(beeId)).toEqual({ entity_id: String(recId), last_written_state: { text, completed: true } });

    await run(beeId, bee); // replay of the same change (stream + feed both deliver it)
    expect(await rec(recId)).toEqual({ status: "tried", bee_todo_id: null });
    expect(await sync(beeId)).toEqual({ entity_id: String(recId), last_written_state: { text, completed: true } });
  });

  it("an echo of what Earmark wrote changes nothing (open or completed)", async () => {
    const a = await linked("queued", { text, completed: false });
    await run(a.beeId, fakeBee([todo(a.beeId)]));
    expect(await rec(a.recId)).toEqual({ status: "queued", bee_todo_id: String(a.beeId) });

    // Earmark completed it because the tip was tried in the garden; the completion comes back from Bee.
    const b = await linked("tried", { text, completed: true }, false);
    await run(b.beeId, fakeBee([todo(b.beeId, { completed: true })]));
    expect(await rec(b.recId)).toEqual({ status: "tried", bee_todo_id: null });
    expect(await sync(b.beeId)).toMatchObject({ last_written_state: { text, completed: true } });
  });

  it("a text edit in Bee keeps the stored state and the tip as it was", async () => {
    const { recId, beeId } = await linked("queued", { text, completed: false });
    await run(beeId, fakeBee([todo(beeId, { text: "Listen to this one Saturday" })]));
    expect(await rec(recId)).toEqual({ status: "queued", bee_todo_id: String(beeId) });
    expect(await sync(beeId)).toMatchObject({ last_written_state: { text, completed: false } });
  });

  it("deleting a queued tip's todo in Bee sends the tip back to 'new' (never dismissed) and drops the link", async () => {
    const { recId, beeId } = await linked("queued", { text, completed: false });
    const bee = fakeBee(); // 404
    await run(beeId, bee);
    expect(await rec(recId)).toEqual({ status: "new", bee_todo_id: null });
    expect(await sync(beeId)).toBeUndefined();
    await run(beeId, bee); // replay: no longer an Earmark todo
    expect(bee.getTodo).toHaveBeenCalledTimes(1);
    expect(await rec(recId)).toEqual({ status: "new", bee_todo_id: null });
  });

  it("deleting an already-completed todo is housekeeping: the tried tip stays tried", async () => {
    const { recId, beeId } = await linked("tried", { text, completed: true }, false);
    await run(beeId, fakeBee());
    expect(await rec(recId)).toEqual({ status: "tried", bee_todo_id: null });
    expect(await sync(beeId)).toBeUndefined();
  });

  it("unchecking a tried tip's completed todo in Bee re-queues it and re-links that todo with the stored text", async () => {
    const { recId, beeId } = await linked("tried", { text, completed: true }, false);
    await run(beeId, fakeBee([todo(beeId, { text: "my own words" })]));
    expect(await rec(recId)).toEqual({ status: "queued", bee_todo_id: String(beeId) });
    expect(await sync(beeId)).toMatchObject({ last_written_state: { text, completed: false } });
  });

  it("Bee never brings back a dismissed tip", async () => {
    const { recId, beeId } = await linked("dismissed", { text, completed: false });
    await run(beeId, fakeBee([todo(beeId, { completed: true })]));
    expect((await rec(recId)).status).toBe("dismissed");
  });

  it("ignores todos Earmark never wrote and entity types with no registered handler, without reading Bee", async () => {
    const stranger = fakeBee();
    await run(nextBeeId++, stranger);
    const { recId, beeId } = await linked("queued", { text, completed: false }, false, "zz_it_unknown");
    await run(beeId, stranger);
    expect(stranger.getTodo).not.toHaveBeenCalled();
    expect((await rec(recId)).status).toBe("queued");
    await c.query(`delete from bee_sync where entity_type = 'zz_it_unknown' and bee_id = $1`, [beeId]);
  });

  it("throws while another Bee todo writer holds the lease, changing nothing (the change feed retries it)", async () => {
    const { recId, beeId } = await linked("queued", { text, completed: false });
    await c.query(`insert into sync_cursors (name, cursor) values ($1, 'someone-else')`, [lease]);
    try {
      const err = await run(beeId, fakeBee([todo(beeId, { completed: true })])).catch((e: unknown) => e);
      expect(err).toMatchObject({ name: "BeeTodoLeaseBusy" });
      expect((await rec(recId)).status).toBe("queued");
    } finally {
      await c.query(`delete from sync_cursors where name = $1`, [lease]);
    }
  });

  // Backstop: a todo change dropped after 5 attempts (or lost by the stream) is still caught by the scheduled reconciler.
  it("the reconciler backstop finds linked queued tips whose todo is not open in Bee: completed → tried, 404 → 'new'", async () => {
    const done = await linked("queued", { text, completed: false });
    const gone = await linked("queued", { text, completed: false });
    const open = await linked("queued", { text, completed: false });
    const off = await linked("queued", { text, completed: false }); // not in the list, and Bee says it is still open
    const store = new Map([[done.beeId, todo(done.beeId, { completed: true })], [off.beeId, todo(off.beeId)]]);
    const bee = {
      listTodos: vi.fn(async () => ({ todos: [todo(open.beeId)], next_cursor: null })),
      getTodo: vi.fn(async (id: number) => {
        const t = store.get(id);
        if (!t) throw new BeeApiError(404, `/v1/todos/${id}`, "not found");
        return t;
      }),
      createTodo: vi.fn(), updateTodo: vi.fn(), deleteTodo: vi.fn(),
    };
    const { drainTodoQueue } = await import("../../agent/lib/sync/bee-todos");
    const { handleRecTodoChange } = await import("../../agent/lib/sync/todo-handlers");
    const out = await drainTodoQueue({
      bee: bee as never, env: { BEE_TODO_WRITES: "on" }, onlyIds: [done.recId, gone.recId, open.recId, off.recId],
      checkLinked: handleRecTodoChange, lease,
    });
    expect(out).toMatchObject({ status: "done", created: 0, failed: false });
    expect(bee.getTodo.mock.calls.map(([id]) => id).sort()).toEqual([done.beeId, gone.beeId, off.beeId].sort());
    expect(await rec(done.recId)).toEqual({ status: "tried", bee_todo_id: null });
    expect(await sync(done.beeId)).toMatchObject({ last_written_state: { text, completed: true } });
    expect(await rec(gone.recId)).toEqual({ status: "new", bee_todo_id: null });
    expect(await sync(gone.beeId)).toBeUndefined();
    expect(await rec(open.recId)).toEqual({ status: "queued", bee_todo_id: String(open.beeId) });
    expect(await rec(off.recId)).toEqual({ status: "queued", bee_todo_id: String(off.beeId) });
    expect(bee.createTodo).not.toHaveBeenCalled();
    // The open todo's old-format text (a /shelf link) is refreshed to the tip's text (decision 049); nothing else writes.
    expect(bee.updateTodo.mock.calls).toEqual([[open.beeId, { text: expect.stringMatching(/\/tips\/\d+$/) }]]);
    expect(bee.deleteTodo).not.toHaveBeenCalled();
  });

  it("a Bee error other than 404 throws and changes nothing", async () => {
    const { recId, beeId } = await linked("queued", { text, completed: false });
    const bee = { getTodo: vi.fn(async () => { throw new BeeApiError(500, "/v1/todos/x", "boom"); }) };
    await expect(run(beeId, bee as never)).rejects.toMatchObject({ status: 500 });
    expect(await rec(recId)).toEqual({ status: "queued", bee_todo_id: String(beeId) });
  });
});
