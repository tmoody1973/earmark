import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool, type PoolClient } from "@neondatabase/serverless";
import type { ExternalDeps, ForgetHook, ForgetHookContext } from "../../agent/lib/privacy/forget";

// Lane C's episodes hook deletes audio with @vercel/blob's del: faked here, so no Blob call is made.
const blobDel = vi.hoisted(() => vi.fn<(url: string) => Promise<void>>(async () => {}));
vi.mock("@vercel/blob", async (orig) => ({ ...(await orig<typeof import("@vercel/blob")>()), del: blobDel }));

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
    const seen: Omit<ForgetHookContext, "c">[] = [];
    const hook: ForgetHook = {
      name: "it_hook",
      run: async (ctx) => {
        await ctx.c.query("select 1"); // hooks get the transaction's client
        seen.push({ target: ctx.target, recommenderFirstName: ctx.recommenderFirstName, recommenderRemoved: ctx.recommenderRemoved });
        return "it_hook 0";
      },
    };
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
  const addMention = async (clusterId: number, at: string, status = "accepted") => Number((await one(
    `insert into idea_mentions (cluster_id, excerpt, spoken_at, confidence, source, review_status) values ($1, 'it forget', $2, 0.9, 'voice', $3) returning id`,
    [clusterId, at, status])).id);
  const addProposal = async (kind: "taste" | "idea", evidence: number[], beeFactId: number | null) => Number((await one(
    `insert into fact_proposals (text, kind, evidence_ids, bee_fact_id) values ($1, $2, $3::jsonb, $4) returning id`,
    [`it-forget-${RUN}`, kind, JSON.stringify(evidence), beeFactId])).id);

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
    await c.query(`delete from fact_proposals where text = $1`, [`it-forget-${RUN}`]);
    await c.query(`delete from gardener_runs where output_md like $1`, [`%it-forget-${RUN}%`]);
    await c.query(`delete from episodes where script_md like $1`, [`%it-forget-${RUN}%`]);
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

  // ── review fixes ─────────────────────────────────────────────────────────────────────────────────────────────────
  const C = "2026-10-05T15:00:00.000Z";
  const addDraftedCluster = async () => {
    const timeline = JSON.stringify([{ date: A, line: "Oct 1: first" }, { date: B, line: "Oct 3: second" }, { date: C, line: "Oct 5: third" }]);
    const id = Number((await one(
      `insert into idea_clusters (title, summary, stage, mention_count, first_mentioned_at, last_mentioned_at, timeline,
                                  draft_md, draft_format, draft_attempts, bee_fact_id, notion_page_id)
       values ('IT forget drafted', 'it summary', 'drafted', 3, $1, $2, $3::jsonb, '# it draft', 'newsletter_pitch', 2, $4, $5) returning id`,
      [A, C, timeline, beeId(7), `pg3-${RUN}`])).id);
    clusterIds.push(id);
    return id;
  };

  it("forgetting one mention of several removes derived text: summary, draft, the idea's Bee fact, Notion page, fact proposals", async () => {
    const { forget, formatPlan } = await mod();
    const cid = await addDraftedCluster();
    await addMention(cid, A);
    await addMention(cid, B);
    const m3 = await addMention(cid, C);
    await c.query(`insert into bee_sync (entity_type, entity_id, bee_object, bee_id) values ('idea', $1, 'fact', $2)`, [cid, beeId(7)]);
    const pid = await addProposal("idea", [cid], beeId(8));

    const d = fakeDeps();
    const dry = await forget(c, { type: "mention", id: m3 }, { yes: false, deps: d as ExternalDeps });
    expect(dry.plan).toMatchObject({
      resolved: { type: "mention", id: m3 }, deletes: { idea_mentions: 1, bee_sync: 1, fact_proposals: 1 },
      refs: { beeFactIds: [beeId(7), beeId(8)], notionPageIds: [`pg3-${RUN}`] },
    });
    expect(formatPlan(dry.plan).join("\n")).not.toContain("title came from this mention");

    const r = await forget(c, { type: "mention", id: m3 }, { yes: true, deps: d as ExternalDeps });
    expect(r.incomplete).toBe(0);
    expect(d.deleteFact.mock.calls).toEqual([[beeId(7)], [beeId(8)]]);
    expect(d.trashNotionPage.mock.calls).toEqual([[`pg3-${RUN}`]]);
    expect(await one(`select title, summary, draft_md, draft_format, draft_claimed_at, draft_attempts, stage, mention_count,
                             bee_fact_id, notion_page_id, jsonb_array_length(timeline) as lines from idea_clusters where id = $1`, [cid]))
      .toEqual({
        title: "IT forget drafted", summary: null, draft_md: null, draft_format: null, draft_claimed_at: null, draft_attempts: 0,
        stage: "sprouting", mention_count: 2, bee_fact_id: null, notion_page_id: null, lines: 2,
      });
    expect(await count(`fact_proposals where id = $1`, [pid])).toBe(0);
    expect(await count(`bee_sync where entity_type = 'idea' and entity_id = $1`, [cid])).toBe(0);
  });

  it("forgetting the mention the title came from warns in the dry run and retitles to a placeholder", async () => {
    const { forget, formatPlan } = await mod();
    const cid = await addCluster();
    const first = await addMention(cid, A);
    await addMention(cid, B);
    const dry = await forget(c, { type: "mention", id: first }, { yes: false, deps: fakeDeps() as ExternalDeps });
    expect(formatPlan(dry.plan).join("\n")).toContain("title came from this mention: forget the whole idea, or it will be retitled");
    const r = await forget(c, { type: "mention", id: first }, { yes: true, deps: fakeDeps() as ExternalDeps });
    expect(r.lines).toContain(`retitled idea ${cid} to "Untitled idea" (titles are not stored per mention)`);
    expect((await one(`select title from idea_clusters where id = $1`, [cid])).title).toBe("Untitled idea");
  });

  it("a mention with no matching timeline line fails the transaction instead of leaving the line behind", async () => {
    const { forget } = await mod();
    const cid = await addCluster();
    await addMention(cid, A);
    const odd = await addMention(cid, C); // the cluster's timeline has no line dated C
    await expect(forget(c, { type: "mention", id: odd }, { yes: true, deps: fakeDeps() as ExternalDeps }))
      .rejects.toMatchObject({ name: "ForgetTimelineError" });
    expect(await count(`idea_mentions where id = $1`, [odd])).toBe(1);
  });

  it("hooks run inside the transaction: a failing hook rolls everything back and a re-run retries", async () => {
    const { forget } = await mod();
    const id = await addRec(null);
    const bad: ForgetHook = { name: "it_bad", run: async () => { throw Object.assign(new Error("x"), { name: "HookBoom" }); } };
    await expect(forget(c, { type: "rec", id }, { yes: true, deps: fakeDeps() as ExternalDeps, hooks: [bad] }))
      .rejects.toMatchObject({ name: "ForgetHookError" });
    expect(await count(`recommendations where id = $1`, [id])).toBe(1);
    const { hook } = recordingHook();
    const r = await forget(c, { type: "rec", id }, { yes: true, deps: fakeDeps() as ExternalDeps, hooks: [hook] });
    expect(r.lines).toContain("hook it_hook: it_hook 0");
    expect(await count(`recommendations where id = $1`, [id])).toBe(0);
  });

  it("a rec's taste fact proposals go, with their Bee facts", async () => {
    const { forget } = await mod();
    const id = await addRec(null);
    const pid = await addProposal("taste", [id, 999_999_999], beeId(9));
    const keep = await addProposal("taste", [999_999_999], null);
    const d = fakeDeps();
    const r = await forget(c, { type: "rec", id }, { yes: true, deps: d as ExternalDeps });
    expect(r.plan.deletes).toMatchObject({ fact_proposals: 1 });
    expect(d.deleteFact.mock.calls).toEqual([[beeId(9)]]);
    expect(await count(`fact_proposals where id = $1`, [pid])).toBe(0);
    expect(await count(`fact_proposals where id = $1`, [keep])).toBe(1);
  });

  it("an idea's fact proposals go with the idea", async () => {
    const { forget } = await mod();
    const cid = await addCluster();
    await addMention(cid, A);
    const pid = await addProposal("idea", [cid], beeId(10));
    // lane C maps a proposal's Bee fact in bee_sync (entity_type 'fact_proposal'): it goes with the proposal
    await c.query(`insert into bee_sync (entity_type, entity_id, bee_object, bee_id) values ('fact_proposal', $1, 'fact', $2)`, [pid, beeId(10)]);
    const d = fakeDeps();
    await forget(c, { type: "idea", id: cid }, { yes: true, deps: d as ExternalDeps });
    expect(d.deleteFact.mock.calls).toEqual([[beeId(10)]]);
    expect(await count(`fact_proposals where id = $1`, [pid])).toBe(0);
    expect(await count(`bee_sync where entity_type = 'fact_proposal' and entity_id = $1`, [pid])).toBe(0);
  });

  it("refuses when the mention became its idea's last between the outside pass and the transaction", async () => {
    const { forget } = await mod();
    const cid = await addCluster(beeId(11));
    const m1 = await addMention(cid, A);
    const m2 = await addMention(cid, B);
    const d = fakeDeps();
    d.deleteFact.mockImplementationOnce(async () => { await c.query(`update idea_mentions set review_status = 'dismissed' where id = $1`, [m1]); });
    await expect(forget(c, { type: "mention", id: m2 }, { yes: true, deps: d as ExternalDeps }))
      .rejects.toMatchObject({ name: "ForgetRefsChangedError" });
    expect(await count(`idea_mentions where id = $1`, [m2])).toBe(1);
  });

  const readyClusterWithClaim = async () => {
    const cid = await addCluster();
    await addMention(cid, A);
    const m2 = await addMention(cid, B);
    await c.query(`update idea_clusters set stage = 'ready' where id = $1`, [cid]);
    const { claimDraftableClusters } = await import("../../agent/lib/store/ideas");
    const [claim] = await claimDraftableClusters({ clusterIds: [cid], limit: 1 });
    return { cid, m2, claim: claim! };
  };

  it("refuses while a draft is being written for the idea (claim inside its lease); the dry run says so", async () => {
    const { forget, formatPlan } = await mod();
    const { cid, m2 } = await readyClusterWithClaim();
    const dry = await forget(c, { type: "mention", id: m2 }, { yes: false, deps: fakeDeps() as ExternalDeps });
    expect(formatPlan(dry.plan).join("\n")).toContain("a draft is being written");
    const d = fakeDeps();
    await expect(forget(c, { type: "mention", id: m2 }, { yes: true, deps: d as ExternalDeps }))
      .rejects.toMatchObject({ name: "ForgetDraftInFlightError", message: `idea ${cid}: a draft is being written, retry in a few minutes` });
    expect(await count(`idea_mentions where id = $1`, [m2])).toBe(1);
    await expect(forget(c, { type: "idea", id: cid }, { yes: true, deps: d as ExternalDeps })).rejects.toMatchObject({ name: "ForgetDraftInFlightError" });
  });

  it("a drafter whose claim outlived the lease cannot save after forget: its late save is a no-op", async () => {
    const { forget } = await mod();
    const { db } = await import("../../agent/lib/db");
    const { saveDraft } = await import("../../agent/lib/store/ideas");
    const { cid, m2 } = await readyClusterWithClaim();
    // A slow drafter: its claim (and so its token) dates from 16 minutes ago.
    const stale = String((await one(
      `update idea_clusters set draft_claimed_at = now() - interval '16 minutes' where id = $1 returning draft_claimed_at::text as claim`, [cid])).claim);
    // Three mentions stay after the forget, so the idea is still 'ready' with no draft: only the claim guard stops the save.
    const D = "2026-10-07T15:00:00.000Z";
    await addMention(cid, C);
    await addMention(cid, D);
    await c.query(`update idea_clusters set timeline = timeline || $2::jsonb where id = $1`,
      [cid, JSON.stringify([{ date: C, line: "Oct 5: third" }, { date: D, line: "Oct 7: fourth" }])]);
    await forget(c, { type: "mention", id: m2 }, { yes: true, deps: fakeDeps() as ExternalDeps });
    expect((await one(`select stage from idea_clusters where id = $1`, [cid])).stage).toBe("ready");
    const [saved] = await db().transaction((txn) => [saveDraft(txn, cid, "# late draft", "newsletter_pitch", stale)]);
    expect(saved).toHaveLength(0);
    expect(await one(`select draft_md, stage from idea_clusters where id = $1`, [cid])).toEqual({ draft_md: null, stage: "ready" });
  });

  it("when only dismissed mentions would remain, the whole idea is forgotten, dismissed mentions included", async () => {
    const { forget } = await mod();
    const cid = await addCluster();
    await addMention(cid, A, "dismissed");
    const live = await addMention(cid, B);
    const dry = await forget(c, { type: "mention", id: live }, { yes: false, deps: fakeDeps() as ExternalDeps });
    expect(dry.plan).toMatchObject({ resolved: { type: "idea", id: cid }, deletes: { idea_clusters: 1, idea_mentions: 2 } });
    await forget(c, { type: "mention", id: live }, { yes: true, deps: fakeDeps() as ExternalDeps });
    expect(await count(`idea_mentions where cluster_id = $1`, [cid])).toBe(0);
  });

  it("lane C hooks: forgetting a rec removes the episode and gardener draft naming its recommender, audio last", async () => {
    const { forget } = await mod();
    const { FORGET_HOOKS } = await import("../../agent/lib/privacy/forget-hooks");
    const who = `${NAME}c`;
    const id = await addRec(await addRecommender(who));
    const week = (RUN % 100_000) * 2; // days after 2300-01-01: unique per run, never a real week
    const episode = async (offset: number, script: string, audio: string) => Number((await one(
      `insert into episodes (week_of, script_md, audio_url) values (date '2300-01-01' + $1::int, $2, $3) returning id`,
      [week + offset, `${script} it-forget-${RUN}`, audio])).id);
    const named = await episode(0, `${who} suggested a book.`, `https://blob.test/${RUN}-named.mp3`);
    const other = await episode(1, "Nobody named.", `https://blob.test/${RUN}-other.mp3`);
    const run = async (text: string) => Number((await one(
      `insert into gardener_runs (gardener_id, output_md) values ((select id from gardeners order by id limit 1), $1) returning id`,
      [`${text} it-forget-${RUN}`])).id);
    const draft = await run(`## Pitch\n${who}'s tip.`);
    const keep = await run("No one named.");
    blobDel.mockClear();

    const r = await forget(c, { type: "rec", id }, { yes: true, deps: fakeDeps() as ExternalDeps, hooks: FORGET_HOOKS });
    expect(r.lines).toContain(`hook gardener_runs: gardener_runs 1 (ids ${draft})`);
    expect(r.lines).toContain(`hook episodes: episodes 1 (ids ${named}), audio 1`);
    expect(r.lines.join("\n")).not.toContain(who);
    expect(blobDel.mock.calls).toEqual([[`https://blob.test/${RUN}-named.mp3`]]);
    expect(await count(`episodes where id = any($1::bigint[])`, [[named, other]])).toBe(1);
    expect(await count(`gardener_runs where id = any($1::bigint[])`, [[draft, keep]])).toBe(1);
    expect(await count(`recommendations where id = $1`, [id])).toBe(0);
  });

  // Merges (M4-T6, decision 027): a forget that touches a merge ends its undo, and leaves no text behind anywhere.
  const MOVED_AT = "2026-10-04T15:00:00.000Z";
  const mergedPair = async () => {
    const keep = await addCluster();
    await addMention(keep, A);
    await addMention(keep, B);
    const other = Number((await one(
      `insert into idea_clusters (title, stage, mention_count, first_mentioned_at, last_mentioned_at, timeline)
       values ('IT forget merged', 'compost', 1, $1, $1, $2::jsonb) returning id`,
      [MOVED_AT, JSON.stringify([{ date: MOVED_AT, line: `Oct 4: it-forget-moved-${RUN}` }])])).id);
    clusterIds.push(other);
    const moved = await addMention(other, MOVED_AT);
    const { mergeClusters } = await import("../../agent/lib/garden/merge");
    const mergeId = (await mergeClusters(keep, other))!;
    return { keep, other, moved, mergeId };
  };
  const textLeft = async (keep: number, other: number) =>
    count(`idea_clusters where id in ($1, $2) and timeline::text like $3`, [keep, other, `%it-forget-moved-${RUN}%`]);

  it("forgetting a moved mention after a merge removes it and its line everywhere, and ends the merge's undo", async () => {
    const { forget } = await mod();
    const { undoMerge } = await import("../../agent/lib/garden/merge");
    const { keep, other, moved, mergeId } = await mergedPair();
    expect(await textLeft(keep, other)).toBe(1); // the line moved to the kept idea
    const dry = await forget(c, { type: "mention", id: moved }, { yes: false, deps: fakeDeps() as ExternalDeps });
    expect(dry.plan.deletes).toMatchObject({ idea_mentions: 1, idea_merges: 1 });
    await forget(c, { type: "mention", id: moved }, { yes: true, deps: fakeDeps() as ExternalDeps });
    expect(await count(`idea_mentions where id = $1`, [moved])).toBe(0);
    expect(await textLeft(keep, other)).toBe(0);
    expect(await count(`idea_merges where id = $1`, [mergeId])).toBe(0);
    expect(await undoMerge(mergeId)).toBe(false);
    expect(await count(`idea_clusters where id = $1 and mention_count = 2`, [keep])).toBe(1);
  });

  it("refuses to forget a merged idea while its merge can be undone; forgetting the kept idea ends the merge", async () => {
    const { forget } = await mod();
    const { keep, other, mergeId } = await mergedPair();
    const dry = await forget(c, { type: "idea", id: other }, { yes: false, deps: fakeDeps() as ExternalDeps });
    expect(dry.plan.notes.join(" ")).toContain(`merged into ${keep}`);
    await expect(forget(c, { type: "idea", id: other }, { yes: true, deps: fakeDeps() as ExternalDeps }))
      .rejects.toMatchObject({ name: "ForgetMergedError", message: expect.stringContaining(`merged into ${keep}: undo the merge or forget ${keep}`) });
    expect(await count(`idea_clusters where id = $1`, [other])).toBe(1);

    const dryKeep = await forget(c, { type: "idea", id: keep }, { yes: false, deps: fakeDeps() as ExternalDeps });
    expect(dryKeep.plan.deletes).toMatchObject({ idea_clusters: 1, idea_mentions: 3, idea_merges: 1 });
    await forget(c, { type: "idea", id: keep }, { yes: true, deps: fakeDeps() as ExternalDeps });
    expect(await count(`idea_merges where id = $1`, [mergeId])).toBe(0);
    expect(await textLeft(keep, other)).toBe(0);
    // with its merge gone, the merged idea can be forgotten too
    await forget(c, { type: "idea", id: other }, { yes: true, deps: fakeDeps() as ExternalDeps });
    expect(await count(`idea_clusters where id = $1`, [other])).toBe(0);
  });
});
