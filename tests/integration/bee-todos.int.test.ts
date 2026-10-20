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
      getTodo: vi.fn(async (id: number) => { const t = todos.get(id); if (!t) throw gone(id); return t; }),
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
  // No test reaches a model: a stub answers, and a test that expects no model call gets one that throws.
  const noModel = vi.fn(async () => { throw new Error("no model call expected"); });
  const drain = async (bee: ReturnType<typeof fakeBee>, onlyIds: number[], generate: unknown = noModel) =>
    (await mod()).drainTodoQueue({ bee, env, onlyIds, generate: generate as never });

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
    expect(text).toBe(`Earmark · Listen: IT Alpha, IT Band (Oct 12) https://earmark.test/tips/${a}`);
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
    const orphan = bee.add({ text: `Earmark · Listen: IT Crash, IT Band (Oct 12) https://earmark.test/tips/${a}`, completed: false });
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

  it("an Earmark todo Tarik edited in Bee (prefix gone) still counts toward the cap: it is ours by id", async () => {
    const holder = await addRec("queued");
    const recs = [await addRec("queued"), await addRec("queued")];
    const bee = fakeBee(Array.from({ length: 9 }, (_, i) => ({ text: `Earmark · Listen: old ${i}`, completed: false })));
    const edited = bee.add({ text: "listen to the IT band thing", completed: false });
    await c.query(`update recommendations set bee_todo_id = $2 where id = $1`, [holder, edited]);
    expect(await drain(bee, recs)).toMatchObject({ open: 10, created: 0 });
    expect(bee.createTodo).not.toHaveBeenCalled();
  });

  it("a queued tip whose own todo is still open in Bee is re-linked without a write and isn't counted as created", async () => {
    const a = await addRec("queued");
    const bee = fakeBee();
    await drain(bee, [a]);
    const first = Number((await rec(a)).bee_todo_id);
    await c.query(`update recommendations set bee_todo_id = null where id = $1`, [a]); // e.g. a crash mid saveLeft
    expect(await drain(bee, [a])).toMatchObject({ created: 0, adopted: 1 });
    expect(bee.updateTodo).not.toHaveBeenCalled();
    expect(Number((await rec(a)).bee_todo_id)).toBe(first);
  });

  it("keeps one write of headroom so a create can always be undone inside the per-run cap", async () => {
    const { MAX_WRITES_PER_RUN } = await mod();
    const bee = fakeBee();
    const leaving = await Promise.all(Array.from({ length: MAX_WRITES_PER_RUN - 1 }, () => addRec("queued")));
    for (const id of leaving) {
      const todo = bee.add({ text: "Earmark · Listen: tracked", completed: false });
      await c.query(`update recommendations set bee_todo_id = $2, status = 'dismissed' where id = $1`, [id, todo]);
    }
    const q = await addRec("queued");
    expect(await drain(bee, [...leaving, q])).toMatchObject({ removed: MAX_WRITES_PER_RUN - 1, created: 0 });
    expect(await drain(bee, [...leaving, q])).toMatchObject({ created: 1 });
  });

  describe("owner fixes a tip (decision 049)", () => {
    const words = async (id: number) => (await c.query(
      `select canonical_name, creator, type, enrichment_status from recommendations where id = $1`, [id])).rows[0];
    // A queued tip with its todo made, then Tarik's edit of that todo's text in the Bee app.
    async function edited(name: string, text: (id: number) => string) {
      const a = await addRec("queued", name);
      const bee = fakeBee();
      await drain(bee, [a]);
      const beeId = Number((await rec(a)).bee_todo_id);
      bee.todos.set(beeId, { ...bee.todos.get(beeId)!, text: text(a) });
      bee.updateTodo.mockClear();
      return { a, bee, beeId };
    }

    it("a text edit in Bee is a fix: the tip gets the new words and is looked up again, and Bee gets the clean text", async () => {
      const { a, bee, beeId } = await edited("IT Sun Raw", () => "Earmark · Listen: Lanquidity, Sun Ra (Oct 12)"); // link deleted
      const out = await drain(bee, [a]);
      expect(await words(a)).toEqual({ canonical_name: "Lanquidity", creator: "Sun Ra", type: "album", enrichment_status: "pending" });
      expect(out).toMatchObject({ status: "done", fixed: 1 });
      expect((await rec(a)).status).toBe("queued");
      const clean = `Earmark · Listen: Lanquidity, Sun Ra (Oct 12) https://earmark.test/tips/${a}`;
      expect(bee.updateTodo.mock.calls).toEqual([[beeId, { text: clean }]]);
      expect(await sync(a)).toMatchObject({ last_written_state: { text: clean, completed: false } });
      expect(noModel).not.toHaveBeenCalled();
    });

    it("the same edit run twice is applied once", async () => {
      const { a, bee } = await edited("IT Twice", () => "Earmark · Listen: IT Once, IT Band");
      await drain(bee, [a]);
      const after = (await c.query(`select updated_at from recommendations where id = $1`, [a])).rows[0];
      expect(await drain(bee, [a])).toMatchObject({ fixed: 0, refreshed: 0 });
      expect(bee.updateTodo).toHaveBeenCalledTimes(1);
      expect((await c.query(`select updated_at from recommendations where id = $1`, [a])).rows[0]).toEqual(after);
    });

    it("a Bee failure writes nothing and the edit is read again next run", async () => {
      const { a, bee } = await edited("IT Retry", () => "Earmark · Listen: IT Retried, IT Band");
      bee.updateTodo.mockRejectedValueOnce(new BeeApiError(500, "/v1/todos", "boom"));
      expect(await drain(bee, [a])).toMatchObject({ fixed: 0, failed: true });
      expect((await words(a)).canonical_name).toBe("IT Retry");
      expect(await drain(bee, [a])).toMatchObject({ fixed: 1, failed: false });
      expect((await words(a)).canonical_name).toBe("IT Retried");
    });

    it("an edit that isn't a fix is left alone in Bee and read once (the model is asked once)", async () => {
      const { a, bee, beeId } = await edited("IT Note", () => "ask Ann which pressing");
      const model = vi.fn(async () => ({ output: { correction: false, name: "", creator: "", type: "other" } }));
      expect(await drain(bee, [a], model)).toMatchObject({ fixed: 0 });
      expect(await drain(bee, [a], model)).toMatchObject({ fixed: 0 });
      expect(model).toHaveBeenCalledTimes(1);
      expect(bee.updateTodo).not.toHaveBeenCalled();
      expect(bee.todos.get(beeId)!.text).toBe("ask Ann which pressing");
      expect((await words(a)).canonical_name).toBe("IT Note");
    });

    it("a free rewrite the model reads as a correction is applied", async () => {
      const { a, bee } = await edited("IT Garble", () => "it was lanquidity by sun ra");
      const model = vi.fn(async () => ({ output: { correction: true, name: "Lanquidity", creator: "Sun Ra", type: "album" } }));
      expect(await drain(bee, [a], model)).toMatchObject({ fixed: 1 });
      expect(await words(a)).toMatchObject({ canonical_name: "Lanquidity", creator: "Sun Ra" });
    });

    it("a model call that fails leaves the edit to be read again next run, not marked seen", async () => {
      const { a, bee, beeId } = await edited("IT Garble", () => "it was lanquidity by sun ra");
      const down = vi.fn(async () => { throw new Error("gateway down"); });
      expect(await drain(bee, [a], down)).toMatchObject({ fixed: 0 });
      expect(bee.todos.get(beeId)!.text).toBe("it was lanquidity by sun ra");
      const model = vi.fn(async () => ({ output: { correction: true, name: "Lanquidity", creator: "Sun Ra", type: "album" } }));
      expect(await drain(bee, [a], model)).toMatchObject({ fixed: 1 });
      expect(await words(a)).toMatchObject({ canonical_name: "Lanquidity", creator: "Sun Ra" });
    });

    it("an edit to a receipt reminder (not a tip's todo) is ignored", async () => {
      const a = await addRec("queued", "IT Receipt Holder");
      const bee = fakeBee();
      await drain(bee, [a]);
      const reminder = bee.add({ text: "Earmark · Listen: IT Hijack, IT Band", completed: false });
      await c.query(`insert into bee_sync (entity_type, entity_id, bee_object, bee_id, last_written_state)
        values ('rec_receipt', $1, 'todo', $2, $3)`, [a, reminder, JSON.stringify({ text: "Earmark · Thank Ann", completed: false })]);
      try {
        expect(await drain(bee, [a])).toMatchObject({ fixed: 0, refreshed: 0 });
        expect(bee.updateTodo).not.toHaveBeenCalled();
        expect((await words(a)).canonical_name).toBe("IT Receipt Holder");
      } finally {
        await c.query(`delete from bee_sync where entity_type = 'rec_receipt' and bee_id = $1`, [reminder]);
      }
    });

    it("a fix on the tip page reaches the open Bee todo on the next run", async () => {
      const a = await addRec("queued", "IT Web Before");
      const bee = fakeBee();
      await drain(bee, [a]);
      const beeId = Number((await rec(a)).bee_todo_id);
      const { applyTipFix } = await import("../../agent/lib/recs/fix-tip");
      expect(await applyTipFix(a, { name: "IT Web After" })).toEqual({ changed: true, requeued: true });
      const out = await drain(bee, [a]);
      const clean = `Earmark · Listen: IT Web After, IT Band (Oct 12) https://earmark.test/tips/${a}`;
      expect(bee.todos.get(beeId)!.text).toBe(clean);
      expect(out).toMatchObject({ refreshed: 1, fixed: 0 });
      expect(await sync(a)).toMatchObject({ last_written_state: { text: clean } });
      expect(await drain(bee, [a])).toMatchObject({ refreshed: 0 });
      expect(bee.updateTodo).toHaveBeenCalledTimes(1);
    });
  });

  describe("createEarmarkTodo (M5 nudges and receipts)", () => {
    const entityType = "it_test_nudge";
    const entityId = 900_000_000 + Math.floor(Math.random() * 1_000_000);
    const create = async (bee: ReturnType<typeof fakeBee>, id = entityId, text = "Earmark · You're near IT Place") =>
      (await mod()).createEarmarkTodo({ entityType, entityId: id, text, alarmAt: "2026-10-20T15:00:00.000Z" }, { bee, env });
    const row = async (id: number) => (await c.query(
      `select bee_id, last_written_state from bee_sync where entity_type = $1 and entity_id = $2 and bee_object = 'todo'`,
      [entityType, id])).rows[0];
    afterAll(async () => { await c.query(`delete from bee_sync where entity_type = $1`, [entityType]); });

    it("creates the todo with its alarm, stores bee_sync under the given entity type, and a retry returns the same todo", async () => {
      const bee = fakeBee();
      const out = await create(bee);
      expect(out).toEqual({ todoId: expect.any(Number) });
      const todoId = (out as { todoId: number }).todoId;
      expect(bee.createTodo).toHaveBeenCalledWith({ text: "Earmark · You're near IT Place", alarmAt: "2026-10-20T15:00:00.000Z" });
      const saved = await row(entityId);
      expect(Number(saved.bee_id)).toBe(todoId);
      expect(saved.last_written_state).toEqual({ text: "Earmark · You're near IT Place", completed: false });
      expect(await create(bee)).toEqual({ todoId });
      expect(bee.createTodo).toHaveBeenCalledTimes(1);
    });

    it("refresh: an open todo for the entity gets the new text and a new alarm (one todo, Bee notifies again); without refresh it is only reused", async () => {
      const bee = fakeBee();
      const id = entityId + 7;
      const first = await create(bee, id, "Earmark · Research ready: IT idea");
      const todoId = (first as { todoId: number }).todoId;
      const again = await (await mod()).createEarmarkTodo(
        { entityType, entityId: id, text: "Earmark · Research: IT idea — the gap is X", alarmAt: "2026-10-20T16:00:00.000Z", refresh: true }, { bee, env });
      expect(again).toEqual({ todoId });
      expect(bee.createTodo).toHaveBeenCalledTimes(1);
      expect(bee.updateTodo).toHaveBeenCalledWith(todoId, { text: "Earmark · Research: IT idea — the gap is X", alarm_at: "2026-10-20T16:00:00.000Z", completed: false });
      expect((await row(id)).last_written_state).toEqual({ text: "Earmark · Research: IT idea — the gap is X", completed: false });
      bee.updateTodo.mockClear();
      expect(await create(bee, id, "Earmark · something else")).toEqual({ todoId }); // no refresh: reused untouched
      expect(bee.updateTodo).not.toHaveBeenCalled();
    });

    it("adds the prefix when missing, and returns { skipped: 'cap' } when 10 Earmark todos are open", async () => {
      const bee = fakeBee(Array.from({ length: 9 }, (_, i) => ({ text: `Earmark · Listen: old ${i}`, completed: false })));
      expect(await create(bee, entityId + 1, "Thank Ann for the tip")).toMatchObject({ todoId: expect.any(Number) });
      expect(bee.createTodo.mock.calls[0]![0].text).toBe("Earmark · Thank Ann for the tip");
      expect(await create(bee, entityId + 2)).toEqual({ skipped: "cap" });
      expect(bee.createTodo).toHaveBeenCalledTimes(1);
    });
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
