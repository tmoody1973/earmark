import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool, type PoolClient } from "@neondatabase/serverless";

// Real Neon `test` branch (TEST_DATABASE_URL, never production); skipped when absent. Only this file's rows are
// touched (ids tracked, deleted after).
describe.skipIf(!process.env.TEST_DATABASE_URL)("rec status core on the Neon test branch (M3-T2)", () => {
  let pool: Pool;
  let c: PoolClient;
  const ids: number[] = [];
  let ann = 0;
  const status = () => import("../../agent/lib/recs/status");

  const addRec = async (s: string, recommender: number | null = ann) => {
    const { rows } = await c.query(
      `insert into recommendations (type, raw_text, canonical_name, excerpt, said_at, source, status, confidence, recommender_id)
       values ('book', 'it status', 'IT status', 'it status', now(), 'ambient', $1, 0.9, $2) returning id`, [s, recommender]);
    ids.push(Number(rows[0].id));
    return Number(rows[0].id);
  };
  const row = async (id: number) => (await c.query(
    `select status, rating, user_verdict, user_verdict_at, updated_at from recommendations where id = $1`, [id])).rows[0];
  const counts = async () => (await c.query(`select recs_given, recs_tried, recs_loved from recommenders where id = $1`, [ann])).rows[0];

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    c = await pool.connect();
    const { rows } = await c.query(`insert into recommenders (first_name) values ('Itstatusann') returning id`);
    ann = Number(rows[0].id);
  });

  afterAll(async () => {
    if (!c) return;
    await c.query(`delete from recommendations where id = any($1::bigint[])`, [ids]);
    await c.query(`delete from recommenders where id = $1`, [ann]);
    c.release();
    await pool.end();
  });

  it("changes a tip once, guarded on its current status, and runs effects only for a real change", async () => {
    const { setRecStatus } = await status();
    const id = await addRec("new");
    const run = vi.fn(async () => {});
    const before = (await row(id)).updated_at as Date;
    expect(await setRecStatus(id, "queued", "garden", { effects: [{ name: "fx", run }] })).toEqual({ changed: true, previous: "new" });
    expect(await setRecStatus(id, "queued", "garden", { effects: [{ name: "fx", run }] })).toEqual({ changed: false, previous: null });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith({ recId: id, previous: "new", next: "queued", origin: "garden", recommenderId: ann });
    expect((await row(id)).status).toBe("queued");
    expect(((await row(id)).updated_at as Date).getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it("two racing identical changes: exactly one wins", async () => {
    const { setRecStatus } = await status();
    const id = await addRec("queued");
    const results = await Promise.all([1, 2, 3].map(() => setRecStatus(id, "tried", "bee", { effects: [] })));
    expect(results.filter((r) => r.changed)).toEqual([{ changed: true, previous: "queued" }]);
  });

  it("never revives a dismissed or composted tip automatically; Tarik can", async () => {
    const { setRecStatus } = await status();
    const dismissed = await addRec("dismissed");
    const composted = await addRec("composted");
    const tried = await addRec("tried");
    expect((await setRecStatus(dismissed, "new", "system", { effects: [] })).changed).toBe(false);
    expect((await setRecStatus(composted, "queued", "bee", { effects: [] })).changed).toBe(false);
    expect((await setRecStatus(tried, "composted", "system", { effects: [] })).changed).toBe(false);
    expect((await row(dismissed)).status).toBe("dismissed");
    expect((await row(composted)).status).toBe("composted");
    expect((await row(tried)).status).toBe("tried");
    expect(await setRecStatus(dismissed, "new", "garden", { effects: [] })).toEqual({ changed: true, previous: "dismissed" });
  });

  it("Maybe? taps (setTipVerdict) behave as before: maybe only, verdict recorded, second tap a no-op", async () => {
    const { setTipVerdict } = await import("../../agent/lib/garden/queries");
    const maybe = await addRec("needs_review");
    const shelf = await addRec("new");
    expect(await setTipVerdict(maybe, "kept")).toBe(true);
    const r = await row(maybe);
    expect(r.status).toBe("new");
    expect(r.user_verdict).toBe("kept");
    expect(r.user_verdict_at).not.toBeNull();
    expect(await setTipVerdict(maybe, "not_a_tip")).toBe(false);
    expect((await row(maybe)).status).toBe("new");
    expect(await setTipVerdict(shelf, "not_a_tip")).toBe(false);
    expect((await row(shelf)).user_verdict).toBeNull();
  });

  it("keeps the recommender's counters true; rating a queued tip marks it tried", async () => {
    const { setRecRating, setRecStatus } = await status();
    const id = await addRec("queued");
    await setRecRating(id, "loved", "notion", { effects: [] });
    expect((await row(id))).toMatchObject({ status: "tried", rating: "loved" });
    const n = await counts();
    const given = Number((await c.query(`select count(*) from recommendations where recommender_id = $1`, [ann])).rows[0].count);
    const tried = Number((await c.query(
      `select count(*) from recommendations where recommender_id = $1 and status in ('tried','thanked')`, [ann])).rows[0].count);
    expect(n).toEqual({ recs_given: given, recs_tried: tried, recs_loved: 1 });
    await setRecRating(id, null, "notion", { effects: [] });
    expect((await counts()).recs_loved).toBe(0);
    expect((await setRecStatus(id, "thanked", "garden", { effects: [] })).changed).toBe(true);
  });

  it("a shelf card's choices (setTipChoice, FR-22): each guarded, a repeat tap a no-op, effects deferred", async () => {
    const { setTipChoice } = await import("../../agent/lib/garden/queries");
    const later: Array<() => Promise<void>> = [];
    const defer = (fn: () => Promise<void>) => { later.push(fn); }; // never run: no Bee nudge from a test
    const tip = await addRec("new");
    expect(await setTipChoice(tip, "queue", { defer })).toBe(true);
    expect(await setTipChoice(tip, "queue", { defer })).toBe(false);
    expect((await row(tip)).status).toBe("queued");
    expect(later).toHaveLength(1); // the queued change's effects were handed to defer, not awaited
    expect(await setTipChoice(tip, "tried", { defer })).toBe(true);
    expect(await setTipChoice(tip, "queue", { defer })).toBe(false); // a tried tip never goes back on the try list
    expect(await setTipChoice(tip, "loved", { defer })).toBe(true);
    expect(await setTipChoice(tip, "loved", { defer })).toBe(false);
    expect(await row(tip)).toMatchObject({ status: "tried", rating: "loved" });
    expect((await counts()).recs_loved).toBeGreaterThanOrEqual(1);
    expect(await setTipChoice(tip, "dismiss", { defer })).toBe(false); // a tried tip keeps its giver's counts
    expect((await row(tip)).status).toBe("tried");
    const untried = await addRec("queued");
    expect(await setTipChoice(untried, "dismiss", { defer })).toBe(true);
    expect((await row(untried)).status).toBe("dismissed");
    expect(await setTipChoice(untried, "loved", { defer })).toBe(false); // no rating lands on a hidden tip
    const maybe = await addRec("needs_review");
    expect(await setTipChoice(maybe, "dismiss", { defer })).toBe(false); // maybes have their own row
    expect(await setTipChoice(maybe, "tried", { defer })).toBe(false);
    expect(await setTipChoice(maybe, "fine", { defer })).toBe(false);
    expect(await row(maybe)).toMatchObject({ status: "needs_review", rating: null });
    expect((await row(untried)).rating).toBeNull();
  });

  it("getRec returns the tip with typed fields from the real schema", async () => {
    const { getRec } = await import("../../agent/lib/store/rec-rows");
    const id = await addRec("new");
    const rec = await getRec(id);
    expect(rec).toMatchObject({
      id, status: "new", recommender_id: ann, recommender_first_name: "Itstatusann", enrichment_status: "pending",
      review_reason: null, user_verdict: null, links: {}, confidence: expect.closeTo(0.9, 5),
    });
    expect(rec!.pending_since).toBeInstanceOf(Date);
    expect(rec).not.toHaveProperty("embedding");
    expect(await getRec(999_999_999)).toBeNull();
  });
});
