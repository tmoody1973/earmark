import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool, type PoolClient } from "@neondatabase/serverless";
import { evaluateSpaces } from "../../agent/lib/spaces/evaluate";
import { deleteSpace, getSpace, listSpaces, setSpaceItemStatus } from "../../agent/lib/garden/spaces";

// Real Neon test on the `test` branch: needs TEST_DATABASE_URL (never production). Skipped when absent.
// Synthetic rows only ("IT spaces …"). Other suites run on the branch at the same time, so this file never writes a
// judgement about their rows: its items are dated ahead (the pass takes the newest changes first), runs are capped
// small, and the mocked Jev fails for anything else, so no row is written for it (three failures stop the run).
describe.skipIf(!process.env.TEST_DATABASE_URL)("Smart Spaces on the Neon test branch (M4-T7)", { timeout: 60_000 }, () => {
  let pool: Pool;
  let c: PoolClient;
  let space = 0;
  let idea = 0;
  let tip = 0;
  let hidden = 0;
  const mine = (state: Record<string, string>) => state.item.includes("IT spaces");
  const ask = vi.fn(async (state: Record<string, string>, qs: Record<string, unknown>) => {
    if (!mine(state)) throw new Error("not this file's item");
    return Object.fromEntries(Object.keys(qs).map((k) => [k, 0.9]));
  });
  const row = async (type: string, id: number) =>
    (await c.query(`select status, confidence, judged_at from space_items where space_id = $1 and item_type = $2 and item_id = $3`,
      [space, type, id])).rows[0];
  const judgedNow = () => ask.mock.calls.filter((call) => mine(call[0])).length;
  const dateAhead = async (table: string, id: number, days: number) =>
    c.query(`update ${table} set updated_at = now() + make_interval(days => $2) where id = $1`, [id, days]);

  beforeAll(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    c = await pool.connect();
    // a lock left by a killed run on this branch (its lease would free it in 15 minutes)
    await c.query(`delete from sync_cursors where name = 'spaces_evaluate_lock' and updated_at < now() - interval '2 minutes'`);
    await c.query(`delete from spaces where rule_sentence like 'IT spaces%'`);
    await c.query(`delete from idea_clusters where title like 'IT spaces%'`);
    await c.query(`delete from recommendations where raw_text = 'it spaces'`);
    space = Number((await c.query(`insert into spaces (name, rule_sentence) values ('IT spaces sample', 'IT spaces sample') returning id`)).rows[0].id);
    idea = Number((await c.query(
      `insert into idea_clusters (title, stage, mention_count, first_mentioned_at, last_mentioned_at, timeline)
       values ('IT spaces a record store segment', 'sprouting', 2, now(), now(), $1::jsonb) returning id`,
      [JSON.stringify([{ date: "2026-10-07T00:00:00.000Z", line: "Oct 7: first heard" }])],
    )).rows[0].id);
    const addTip = async (status: string) => Number((await c.query(
      `insert into recommendations (type, raw_text, canonical_name, creator, excerpt, said_at, source, status, confidence)
       values ('book', 'it spaces', 'IT spaces sample novel', 'A. Writer', 'it spaces', now(), 'ambient', $1, 0.95) returning id`, [status],
    )).rows[0].id);
    tip = await addTip("new");
    hidden = await addTip("needs_review");
    await dateAhead("idea_clusters", idea, 1);
    await dateAhead("recommendations", tip, 1);
    await dateAhead("recommendations", hidden, 1);
  });

  afterAll(async () => {
    await c.query(`delete from spaces where rule_sentence like 'IT spaces%'`);
    await c.query(`delete from idea_clusters where title like 'IT spaces%'`);
    await c.query(`delete from recommendations where raw_text = 'it spaces'`);
    c.release();
    await pool.end();
  });

  it("judges the visible items, skips hidden ones, and shows the members", async () => {
    const out = await evaluateSpaces({ spaceId: space, maxCalls: 2, ask: ask as never });
    expect(out).toMatchObject({ busy: false, failed: 0, pairs: 2 });
    expect(judgedNow()).toBe(2);
    expect(await row("idea", idea)).toMatchObject({ status: "suggested", confidence: expect.closeTo(0.9, 5) });
    expect(await row("rec", tip)).toMatchObject({ status: "suggested" });
    expect(await row("rec", hidden)).toBeUndefined(); // a maybe is never judged
    const view = await getSpace(space);
    expect(view!.space.members).toBe(2);
    expect(view!.ideas.map((i) => i.plant.id)).toEqual([idea]);
    expect(view!.tips.map((t) => t.rec.id)).toEqual([tip]);
    // the rest of the branch is still to sort for this Space (other suites change that count while this runs)
    expect(view!.space.pending).toBeGreaterThanOrEqual(0);
    expect((await listSpaces()).find((s) => s.id === space)).toMatchObject({ members: 2, sentence: "IT spaces sample" });
  });

  it("asks nothing again until an item changes; a kept item is never re-asked", async () => {
    // unchanged since judged (dated ahead only to come first; put them back before their judgement)
    await dateAhead("idea_clusters", idea, -1);
    await dateAhead("recommendations", tip, -1);
    ask.mockClear();
    await evaluateSpaces({ spaceId: space, maxCalls: 5, ask: ask as never });
    expect(judgedNow()).toBe(0);

    expect(await setSpaceItemStatus({ spaceId: space, itemType: "idea", itemId: idea }, "accepted")).toBe(true);
    await dateAhead("idea_clusters", idea, 2);
    await dateAhead("recommendations", tip, 2);
    await evaluateSpaces({ spaceId: space, maxCalls: 5, ask: ask as never });
    expect(judgedNow()).toBe(1); // the changed tip, not the kept idea
    expect(ask.mock.calls.find((call) => mine(call[0]))![0].item).toMatch(/^book: IT spaces sample novel/);
  });

  it("a removed item leaves the Space and stays out; deleting the Space keeps the items", async () => {
    expect(await setSpaceItemStatus({ spaceId: space, itemType: "rec", itemId: tip }, "removed")).toBe(true);
    expect(await setSpaceItemStatus({ spaceId: space, itemType: "rec", itemId: tip }, "accepted")).toBe(false); // never revived
    expect((await getSpace(space))!.tips).toEqual([]);
    expect(await deleteSpace(space)).toBe(true);
    expect((await c.query(`select count(*)::int as n from space_items where space_id = $1`, [space])).rows[0].n).toBe(0);
    expect((await c.query(`select count(*)::int as n from recommendations where id = $1`, [tip])).rows[0].n).toBe(1);
    expect(await getSpace(space)).toBeNull();
  });
});
