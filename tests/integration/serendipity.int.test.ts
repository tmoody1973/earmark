import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "@neondatabase/serverless";

// Serendipity (M4-T8) on the real Neon `test` branch (TEST_DATABASE_URL, never production); skipped when absent.
// Its rows are dated ten years back so they are the most forgotten on the branch; only they are touched and deleted.
describe.skipIf(!process.env.TEST_DATABASE_URL)("serendipity on the Neon test branch (M4-T8)", () => {
  let pool: Pool;
  let c: PoolClient;
  const recs: number[] = [];
  const ideas: number[] = [];
  const lib = () => import("../../agent/lib/garden/serendipity");
  const noEffects = { defer: () => {} }; // the status effects (Bee todos) are not this suite's business

  const addRec = async (status: string, yearsAgo = 10) => {
    const { rows } = await c.query(
      `insert into recommendations (type, raw_text, canonical_name, excerpt, said_at, created_at, source, status, confidence)
       values ('book', 'it serendipity', 'IT serendipity tip', 'it', now() - make_interval(years => $2), now() - make_interval(years => $2),
         'ambient', $1, 0.9) returning id`, [status, yearsAgo]);
    recs.push(Number(rows[0].id));
    return Number(rows[0].id);
  };
  const addIdea = async (stage: string, mentions: number, yearsAgo = 10) => {
    const { rows } = await c.query(
      `insert into idea_clusters (title, stage, mention_count, first_mentioned_at, last_mentioned_at, created_at)
       values ('IT serendipity idea', $1, $2, now() - make_interval(years => $3), now() - make_interval(years => $3),
         now() - make_interval(years => $3)) returning id`, [stage, mentions, yearsAgo]);
    ideas.push(Number(rows[0].id));
    return Number(rows[0].id);
  };
  const rec = async (id: number) => (await c.query(`select status, last_surfaced_at from recommendations where id = $1`, [id])).rows[0];
  const idea = async (id: number) => (await c.query(`select stage, last_surfaced_at from idea_clusters where id = $1`, [id])).rows[0];

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    c = await pool.connect();
  });

  afterAll(async () => {
    if (!c) return;
    await c.query(`delete from recommendations where id = any($1::bigint[])`, [recs]);
    await c.query(`delete from idea_clusters where id = any($1::bigint[])`, [ideas]);
    c.release();
    await pool.end();
  });

  it("picks the most forgotten item; Keep sends it to the back of the queue", async () => {
    const { getSerendipity, keepItem } = await lib();
    const oldest = await addIdea("sprouting", 2, 12);
    const tip = await addRec("queued", 11);
    await addIdea("drafted", 3, 20); // never offered: drafted ideas don't move
    expect(await getSerendipity()).toMatchObject({ type: "idea", id: oldest, plant: { stage: "sprouting" } });
    expect(await keepItem({ type: "idea", id: oldest })).toBe(true);
    expect((await idea(oldest)).last_surfaced_at).not.toBeNull();
    expect(await getSerendipity()).toMatchObject({ type: "rec", id: tip, note: expect.stringMatching(/^Heard \d+ days ago$/) });
  });

  it("composts a tip and an idea, and undo brings both back", async () => {
    const { compostItem, undoCompost } = await lib();
    const tip = await addRec("new");
    const plant = await addIdea("sprouting", 2);
    expect(await compostItem({ type: "rec", id: tip }, noEffects)).toEqual({ changed: true, previous: "new" });
    expect(await rec(tip)).toMatchObject({ status: "composted", last_surfaced_at: expect.any(Date) });
    expect(await compostItem({ type: "idea", id: plant })).toEqual({ changed: true, previous: "sprouting" });
    expect((await idea(plant)).stage).toBe("dismissed");
    expect(await compostItem({ type: "idea", id: plant })).toEqual({ changed: false, previous: null }); // already gone

    expect(await undoCompost({ type: "rec", id: tip, previous: "new" }, noEffects)).toBe(true);
    expect((await rec(tip)).status).toBe("new");
    expect(await undoCompost({ type: "idea", id: plant })).toBe(true);
    expect((await idea(plant)).stage).toBe("sprouting"); // regrown by the stage rule: 2 mentions
  });

  it("never composts a drafted idea or a tried tip, and never revives an idea dismissed some other way", async () => {
    const { compostItem, undoCompost } = await lib();
    const drafted = await addIdea("drafted", 3);
    const tried = await addRec("tried");
    const dismissedElsewhere = await addIdea("dismissed", 1);
    expect(await compostItem({ type: "idea", id: drafted })).toEqual({ changed: false, previous: null });
    expect((await idea(drafted)).stage).toBe("drafted");
    expect(await compostItem({ type: "rec", id: tried }, noEffects)).toEqual({ changed: false, previous: null });
    expect((await rec(tried)).status).toBe("tried");
    expect(await undoCompost({ type: "idea", id: dismissedElsewhere })).toBe(false); // no Serendipity stamp
    expect((await idea(dismissedElsewhere)).stage).toBe("dismissed");
  });
});
