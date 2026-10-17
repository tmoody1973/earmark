import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "@neondatabase/serverless";

// Real Neon test on the `test` branch: needs TEST_DATABASE_URL (never production). Skipped when absent.
// Every run is scoped to the rows this file inserts, so other suites' rows on the branch are never re-sorted.
const AT = "2026-10-01T15:00:00Z";

describe.skipIf(!process.env.TEST_DATABASE_URL)("reversible re-sort on the Neon test branch (M2-T10b)", () => {
  let pool: Pool;
  let c: PoolClient;
  const recIds: number[] = [];
  const mentionIds: number[] = [];
  const clusterIds: number[] = [];
  const runIds: string[] = [];
  const mod = () => import("../../scripts/resort");

  const addCluster = async (stage: string, mentionCount: number) => {
    const { rows } = await c.query(`insert into idea_clusters (title, stage, mention_count) values ('IT: resort', $1, $2) returning id`, [stage, mentionCount]);
    clusterIds.push(Number(rows[0].id));
    return Number(rows[0].id);
  };
  const addMention = async (clusterId: number, status: string, confidence: number, source = "ambient", key: string | null = null) => {
    const { rows } = await c.query(
      `insert into idea_mentions (cluster_id, excerpt, spoken_at, confidence, review_status, source, deliberate_key)
       values ($1, 'it resort', $2, $3, $4, $5, $6) returning id`, [clusterId, AT, confidence, status, source, key]);
    mentionIds.push(Number(rows[0].id));
    return Number(rows[0].id);
  };
  const addRec = async (status: string, confidence: number, source = "ambient", key: string | null = null) => {
    const { rows } = await c.query(
      `insert into recommendations (type, raw_text, canonical_name, excerpt, said_at, source, status, confidence, deliberate_key)
       values ('other', 'it resort', 'IT resort', 'it resort', $1, $2, $3, $4, $5) returning id`, [AT, source, status, confidence, key]);
    recIds.push(Number(rows[0].id));
    return Number(rows[0].id);
  };
  const snapshot = async () => ({
    recs: (await c.query(`select id, status from recommendations where id = any($1::bigint[]) order by id`, [recIds])).rows,
    mentions: (await c.query(`select id, review_status from idea_mentions where id = any($1::bigint[]) order by id`, [mentionIds])).rows,
    clusters: (await c.query(`select id, stage, mention_count from idea_clusters where id = any($1::bigint[]) order by id`, [clusterIds])).rows,
  });
  const status = async (table: string, col: string, id: number) =>
    (await c.query(`select ${col} as s from ${table} where id = $1`, [id])).rows[0].s;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    c = await pool.connect();
  });

  afterAll(async () => {
    if (!c) return;
    await c.query(`delete from recommendations where id = any($1::bigint[])`, [recIds]);
    await c.query(`delete from idea_clusters where id = any($1::bigint[])`, [clusterIds]); // cascades to mentions
    await c.query(`delete from resort_backup where run_id = any($1::text[])`, [runIds]);
    c.release();
    await pool.end();
  });

  it("apply moves rows by the tuned thresholds and recounts ideas; undo restores exactly", async () => {
    const { resort, undoResort } = await mod();
    // A bloomed idea: one confident, one middling, one weak mention (the weak one is dismissed → 2 → sprouting).
    const ready = await addCluster("ready", 3);
    const m1 = await addMention(ready, "accepted", 0.95);
    const m2 = await addMention(ready, "accepted", 0.7);
    const m3 = await addMention(ready, "needs_review", 0.4);
    // A drafted idea keeps its stage even when its only mention is dismissed.
    const drafted = await addCluster("drafted", 1);
    const m4 = await addMention(drafted, "accepted", 0.3);
    // Boundaries through a real `real` column, and a deliberate capture that is never touched.
    const compost = await addCluster("compost", 3);
    const m5 = await addMention(compost, "accepted", 0.9);
    const m6 = await addMention(compost, "needs_review", 0.6);
    const m7 = await addMention(compost, "accepted", 0.1, "voice", "u1");
    const r1 = await addRec("new", 0.5);
    const r2 = await addRec("new", 0.9);
    const r3 = await addRec("needs_review", 0.95);
    const r4 = await addRec("queued", 0.1);
    const r5 = await addRec("new", 0.1, "voice", "u2");
    const r6 = await addRec("dismissed", 0.95);
    const r7 = await addRec("new", 0.6);
    const before = await snapshot();
    const scope = { recIds, mentionIds };

    const dry = await resort(c, { apply: false, scope });
    expect(dry.runId).toBeNull();
    expect(await snapshot()).toEqual(before); // the dry run wrote nothing

    const run = await resort(c, { apply: true, scope });
    runIds.push(run.runId!);
    expect(run.moves).toEqual(dry.moves);
    expect(run.clusters).toEqual(dry.clusters);

    const want: Array<[string, string, number, string]> = [
      ["idea_mentions", "review_status", m1, "accepted"],
      ["idea_mentions", "review_status", m2, "needs_review"],
      ["idea_mentions", "review_status", m3, "dismissed"],
      ["idea_mentions", "review_status", m4, "dismissed"],
      ["idea_mentions", "review_status", m5, "needs_review"], // p = 0.9 exactly → review
      ["idea_mentions", "review_status", m6, "needs_review"], // p = 0.6 exactly → review
      ["idea_mentions", "review_status", m7, "accepted"], // deliberate
      ["recommendations", "status", r1, "dismissed"],
      ["recommendations", "status", r2, "needs_review"],
      ["recommendations", "status", r3, "new"],
      ["recommendations", "status", r4, "queued"],
      ["recommendations", "status", r5, "new"],
      ["recommendations", "status", r6, "dismissed"],
      ["recommendations", "status", r7, "needs_review"],
    ];
    for (const [table, col, id, s] of want) expect([table, id, await status(table, col, id)]).toEqual([table, id, s]);
    const clusters = (await snapshot()).clusters.map((r) => [Number(r.id), r.stage, r.mention_count]);
    expect(clusters).toEqual([[ready, "sprouting", 2], [drafted, "drafted", 0], [compost, "compost", 3]]);

    const { rows: backup } = await c.query(`select count(*)::int as n from resort_backup where run_id = $1`, [run.runId]);
    expect(backup[0].n).toBe(run.moves.length + run.clusters.length);

    const undone = await undoResort(c, run.runId!);
    expect(undone.skipped).toBe(0);
    expect(await snapshot()).toEqual(before);
  });

  it("undo leaves a row alone when it changed after the re-sort", async () => {
    const { resort, undoResort } = await mod();
    const r = await addRec("new", 0.7);
    const run = await resort(c, { apply: true, scope: { recIds: [r], mentionIds: [] } });
    runIds.push(run.runId!);
    expect(await status("recommendations", "status", r)).toBe("needs_review");
    await c.query(`update recommendations set status = 'queued' where id = $1`, [r]); // Tarik acted on it
    const undone = await undoResort(c, run.runId!);
    expect(undone).toMatchObject({ restored: [], skipped: 1 });
    expect(await status("recommendations", "status", r)).toBe("queued");
  });

  it("refuses an unknown run_id", async () => {
    const { undoResort } = await mod();
    await expect(undoResort(c, "resort-does-not-exist")).rejects.toMatchObject({ name: "UnknownRunError" });
  });
});
