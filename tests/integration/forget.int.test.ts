import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool, type PoolClient } from "@neondatabase/serverless";
import type { ExternalDeps, ForgetHook, ForgetHookContext } from "../../agent/lib/privacy/forget";

// Real Neon test on the `test` branch: needs TEST_DATABASE_URL (never production). Skipped when absent.
// External services are fakes: no Bee, Notion or Blob call is ever made from here.
const RUN = Date.now() % 1_000_000_000;
const NAME = `Itforget${RUN}`;
const A = "2026-10-01T15:00:00.000Z";
const B = "2026-10-03T15:00:00.000Z";
const beeId = (n: number) => 8_000_000_000 + RUN * 10 + n;

describe.skipIf(!process.env.TEST_DATABASE_URL)("pnpm forget on the Neon test branch (M3-T11)", () => {
  let pool: Pool;
  let c: PoolClient;
  const clusterIds: number[] = [];
  const recIds: number[] = [];
  const spaceIds: number[] = [];
  const mod = () => import("../../agent/lib/privacy/forget");
  const one = async (text: string, values: unknown[] = []) => (await c.query(text, values)).rows[0] as Record<string, unknown>;
  const count = async (text: string, values: unknown[]) => Number((await one(`select count(*)::int as n from ${text}`, values)).n);

  const fakeDeps = () => ({
    deleteTodo: vi.fn<(id: number) => Promise<void>>(async () => {}),
    deleteFact: vi.fn<(id: number) => Promise<void>>(async () => {}),
    trashNotionPage: vi.fn<(pageId: string) => Promise<void>>(async () => {}),
    deleteBlob: vi.fn<(url: string) => Promise<void>>(async () => {}),
  });
  const recordingHook = () => {
    const seen: ForgetHookContext[] = [];
    const hook: ForgetHook = { name: "it_hook", run: async (ctx) => { seen.push(ctx); return "it_hook 0"; } };
    return { hook, seen };
  };

  const addRecommender = async (name: string) => Number((await one(`insert into recommenders (first_name, recs_given) values ($1, 0) returning id`, [name])).id);
  const addRec = async (recommenderId: number | null, extra: { beeTodoId?: number; notionPageId?: string } = {}) => {
    const id = Number((await one(
      `insert into recommendations (type, raw_text, canonical_name, recommender_id, excerpt, said_at, source, confidence, bee_todo_id, notion_page_id)
       values ('book', 'it forget', 'IT Forget', $1, 'it forget excerpt', $2, 'voice', 0.9, $3, $4) returning id`,
      [recommenderId, A, extra.beeTodoId ?? null, extra.notionPageId ?? null])).id);
    recIds.push(id);
    if (recommenderId) await c.query(`update recommenders set recs_given = recs_given + 1 where id = $1`, [recommenderId]);
    return id;
  };
  const addCluster = async (beeFactId: number | null = null) => {
    const timeline = JSON.stringify([{ date: A, line: "Oct 1: first" }, { date: B, line: "Oct 3: second" }]);
    const id = Number((await one(
      `insert into idea_clusters (title, stage, mention_count, first_mentioned_at, last_mentioned_at, timeline, bee_fact_id)
       values ('IT forget idea', 'sprouting', 2, $1, $2, $3::jsonb, $4) returning id`, [A, B, timeline, beeFactId])).id);
    clusterIds.push(id);
    return id;
  };
  const addMention = async (clusterId: number, at: string) => Number((await one(
    `insert into idea_mentions (cluster_id, excerpt, spoken_at, confidence, source) values ($1, 'it forget', $2, 0.9, 'voice') returning id`,
    [clusterId, at])).id);

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    c = await pool.connect();
  });

  afterAll(async () => {
    await c.query(`delete from recommendations where id = any($1::bigint[])`, [recIds]);
    await c.query(`delete from idea_clusters where id = any($1::bigint[])`, [clusterIds]);
    await c.query(`delete from spaces where id = any($1::bigint[])`, [spaceIds]);
    await c.query(`delete from recommenders where first_name like $1`, [`${NAME}%`]);
    await c.query(`delete from resort_backup where run_id = $1`, [`it-forget-${RUN}`]);
    c.release();
    await pool.end();
  });

  it("dry run lists ids and counts and writes nothing; --yes deletes the rec everywhere in one commit, then outside copies", async () => {
    const { forget } = await mod();
    const pid = await addRecommender(NAME);
    const id = await addRec(pid, { beeTodoId: beeId(1), notionPageId: `pg-${RUN}` });
    await c.query(`insert into rec_receipts (recommendation_id, message, share_token, bee_todo_id) values ($1, 'thanks', $2, $3)`, [id, `it-forget-${RUN}`, beeId(2)]);
    await c.query(`insert into photos (recommendation_id, taken_at, thumbnail_url) values ($1, now(), $2)`, [id, `https://blob.test/${RUN}.jpg`]);
    const sid = Number((await one(`insert into spaces (name, rule_sentence) values ('IT forget', 'it') returning id`)).id);
    spaceIds.push(sid);
    await c.query(`insert into space_items (space_id, item_type, item_id, confidence) values ($1, 'rec', $2, 0.9)`, [sid, id]);
    await c.query(`insert into links (from_type, from_id, to_type, to_id, kind, confidence) values ('rec', $1, 'recommender', $2, 'source', 1)`, [String(id), String(pid)]);
    await c.query(`insert into links (from_type, from_id, to_type, to_id, kind, confidence) values ('recommender', $1, 'idea', '1', 'related', 1)`, [String(pid)]);
    await c.query(`insert into bee_sync (entity_type, entity_id, bee_object, bee_id) values ('rec', $1, 'todo', $2), ('rec', $1, 'fact', $3)`, [id, beeId(1), beeId(3)]);
    await c.query(`insert into resort_backup (run_id, table_name, row_id, old_status, new_status) values ($1, 'recommendations', $2, 'new', 'needs_review')`, [`it-forget-${RUN}`, id]);

    const d = fakeDeps();
    const dry = await forget(c, { type: "rec", id }, { yes: false, deps: d as ExternalDeps });
    expect(dry.plan).toMatchObject({
      exists: true,
      deletes: { recommendations: 1, rec_receipts: 1, photos: 1, space_items: 1, links: 2, bee_sync: 2, resort_backup: 1, recommenders: 1 },
      refs: { beeTodoIds: [beeId(1), beeId(2)], beeFactIds: [beeId(3)], notionPageIds: [`pg-${RUN}`], blobUrls: [`https://blob.test/${RUN}.jpg`] },
    });
    expect(d.deleteTodo).not.toHaveBeenCalled();
    expect(await count(`recommendations where id = $1`, [id])).toBe(1);

    const { hook, seen } = recordingHook();
    const done = await forget(c, { type: "rec", id }, { yes: true, deps: d as ExternalDeps, hooks: [hook] });
    expect(done.incomplete).toBe(0);
    expect(d.deleteTodo.mock.calls).toEqual([[beeId(1)], [beeId(2)]]);
    expect(d.deleteFact.mock.calls).toEqual([[beeId(3)]]);
    expect(d.trashNotionPage.mock.calls).toEqual([[`pg-${RUN}`]]);
    expect(d.deleteBlob.mock.calls).toEqual([[`https://blob.test/${RUN}.jpg`]]);
    expect(seen).toEqual([{ target: { type: "rec", id }, recommenderFirstName: NAME, recommenderRemoved: true }]);

    const left = await one(`select
      (select count(*)::int from recommendations where id = $1) as recs,
      (select count(*)::int from rec_receipts where recommendation_id = $1) as receipts,
      (select count(*)::int from photos where recommendation_id = $1) as photos,
      (select count(*)::int from space_items where item_type = 'rec' and item_id = $1) as space_items,
      (select count(*)::int from links where (from_type = 'rec' and from_id = $3) or (from_type = 'recommender' and from_id = $4)) as links,
      (select count(*)::int from bee_sync where entity_type = 'rec' and entity_id = $1) as bee_sync,
      (select count(*)::int from resort_backup where table_name = 'recommendations' and row_id = $1) as backup,
      (select count(*)::int from recommenders where id = $2) as recommenders`, [id, pid, String(id), String(pid)]);
    expect(left).toEqual({ recs: 0, receipts: 0, photos: 0, space_items: 0, links: 0, bee_sync: 0, backup: 0, recommenders: 0 });
    expect((await forget(c, { type: "rec", id }, { yes: true, deps: d as ExternalDeps })).plan.exists).toBe(false);
  });

  it("keeps a recommender who has other recs and recounts them", async () => {
    const { forget } = await mod();
    const pid = await addRecommender(`${NAME}b`);
    const keep = await addRec(pid);
    const gone = await addRec(pid);
    await c.query(`update recommendations set status = 'tried', rating = 'loved' where id = $1`, [keep]);
    const { hook, seen } = recordingHook();
    const r = await forget(c, { type: "rec", id: gone }, { yes: true, deps: fakeDeps() as ExternalDeps, hooks: [hook] });
    expect(r.plan.deletes.recommenders ?? 0).toBe(0);
    expect(r.plan.updates).toMatchObject({ recommenders: 1 });
    expect(await one(`select recs_given, recs_tried, recs_loved from recommenders where id = $1`, [pid])).toEqual({ recs_given: 1, recs_tried: 1, recs_loved: 1 });
    expect(seen[0]).toMatchObject({ recommenderFirstName: `${NAME}b`, recommenderRemoved: false });
    expect(await count(`recommendations where id = $1`, [keep])).toBe(1);
  });

  it("forgets one mention: its row, its timeline line and its backup row go; the idea is recomputed", async () => {
    const { forget } = await mod();
    const cid = await addCluster();
    await addMention(cid, A);
    const m2 = await addMention(cid, B);
    await c.query(`insert into resort_backup (run_id, table_name, row_id, old_status, new_status) values ($1, 'idea_mentions', $2, 'accepted', 'needs_review')`, [`it-forget-${RUN}`, m2]);

    const r = await forget(c, { type: "mention", id: m2 }, { yes: true, deps: fakeDeps() as ExternalDeps });
    expect(r.plan).toMatchObject({ resolved: { type: "mention", id: m2 }, deletes: { idea_mentions: 1, resort_backup: 1 }, updates: { idea_clusters: 1 } });
    const after = await one(`select mention_count, stage, timeline, last_mentioned_at from idea_clusters where id = $1`, [cid]);
    expect(after).toMatchObject({ mention_count: 1, stage: "compost", timeline: [{ date: A, line: "Oct 1: first" }] });
    expect(new Date(after.last_mentioned_at as string).toISOString()).toBe(A);
    expect(await count(`resort_backup where table_name = 'idea_mentions' and row_id = $1`, [m2])).toBe(0);
  });

  it("forgetting an idea's last mention forgets the idea, its Bee fact, events and links", async () => {
    const { forget } = await mod();
    const cid = await addCluster(beeId(4));
    const m = await addMention(cid, A);
    await c.query(`update idea_clusters set mention_count = 1 where id = $1`, [cid]);
    await c.query(`insert into garden_events (kind, cluster_id) values ('mention', $1)`, [cid]);
    await c.query(`insert into links (from_type, from_id, to_type, to_id, kind, confidence) values ('rec', '1', 'idea', $1, 'related', 1)`, [String(cid)]);
    await c.query(`insert into resort_backup (run_id, table_name, row_id, old_status, new_status) values ($1, 'idea_clusters', $2, 'sprouting', 'compost')`, [`it-forget-${RUN}`, cid]);

    const d = fakeDeps();
    const dry = await forget(c, { type: "mention", id: m }, { yes: false, deps: d as ExternalDeps });
    expect(dry.plan).toMatchObject({ resolved: { type: "idea", id: cid }, deletes: { idea_clusters: 1, idea_mentions: 1, garden_events: 1, links: 1, resort_backup: 1 } });
    await forget(c, { type: "mention", id: m }, { yes: true, deps: d as ExternalDeps });
    expect(d.deleteFact.mock.calls).toEqual([[beeId(4)]]);
    expect(await count(`idea_clusters where id = $1`, [cid])).toBe(0);
    expect(await count(`links where to_type = 'idea' and to_id = $1`, [String(cid)])).toBe(0);
    expect(await count(`resort_backup where table_name = 'idea_clusters' and row_id = $1`, [cid])).toBe(0);
  });

  it("an outside failure aborts before Postgres, so the same command can be re-run", async () => {
    const { forget } = await mod();
    const id = await addRec(null, { beeTodoId: beeId(5) });
    const d = fakeDeps();
    d.deleteTodo.mockRejectedValueOnce(Object.assign(new Error("boom"), { name: "BeeApiError", status: 500 }));
    const r = await forget(c, { type: "rec", id }, { yes: true, deps: d as ExternalDeps });
    expect(r.incomplete).toBe(1);
    expect(r.lines).toEqual([`FAILED bee_todo ${beeId(5)} error=BeeApiError`]);
    expect(await count(`recommendations where id = $1`, [id])).toBe(1);

    const again = await forget(c, { type: "rec", id }, { yes: true, deps: d as ExternalDeps });
    expect(again.incomplete).toBe(0);
    expect(await count(`recommendations where id = $1`, [id])).toBe(0);
  });

  it("outside deletes succeed, then Postgres fails: nothing is half-deleted and a re-run completes (404 = done)", async () => {
    const { forget } = await mod();
    const id = await addRec(null, { beeTodoId: beeId(6), notionPageId: `pg2-${RUN}` });
    let failed = false;
    const flaky = {
      query: (text: string, values?: unknown[]) => {
        if (!failed && text.startsWith("delete from recommendations")) {
          failed = true;
          throw Object.assign(new Error("connection lost"), { name: "NeonDbError" });
        }
        return c.query(text, values);
      },
    } as unknown as PoolClient;
    const d = fakeDeps();
    await expect(forget(flaky, { type: "rec", id }, { yes: true, deps: d as ExternalDeps })).rejects.toMatchObject({ name: "NeonDbError" });
    expect(d.deleteTodo).toHaveBeenCalledWith(beeId(6));
    expect(await count(`recommendations where id = $1`, [id])).toBe(1); // rolled back whole

    const gone = () => Promise.reject(Object.assign(new Error("not found"), { name: "BeeApiError", status: 404 }));
    d.deleteTodo.mockImplementation(gone);
    d.trashNotionPage.mockImplementation(gone);
    const again = await forget(c, { type: "rec", id }, { yes: true, deps: d as ExternalDeps });
    expect(again.incomplete).toBe(0);
    expect(again.lines).toEqual([`already gone bee_todo ${beeId(6)}`, `already gone notion_page pg2-${RUN}`, `deleted postgres rec ${id}`]);
    expect(await count(`recommendations where id = $1`, [id])).toBe(0);
  });
});
