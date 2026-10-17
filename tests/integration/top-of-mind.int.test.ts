import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../agent/lib/db";
import { PIN_CAP, setPinned } from "../../agent/lib/garden/top-of-mind";
import { buildSaveQueries, type SaveItem } from "../../agent/lib/pipeline/save-item";
import { pinnedClustersNear } from "../../agent/lib/store/ideas";

// Top of Mind (M4-T9) on the real Neon `test` branch (TEST_DATABASE_URL, never production). No Bee client, no model.
const MARK = "INTTEST-TOM";
const ON = { BEE_TODO_WRITES: "on" };
const sql = () => db();
const vec = (i: number) => Array.from({ length: 1536 }, (_, j) => (j === i ? 1 : j === i + 1 ? 0.3 : 0));

const idea = async (n: number, opts: { stage?: string; centroid?: number[] } = {}) => {
  const [r] = (await sql()`insert into idea_clusters (title, stage, mention_count, first_mentioned_at, last_mentioned_at, centroid)
    values (${`${MARK} ${n}`}, ${opts.stage ?? "sprouting"}, 2, '2026-10-15T15:00:00Z', now(),
      ${opts.centroid ? JSON.stringify(opts.centroid) : null}::vector)
    returning id`) as { id: string }[];
  return Number(r!.id);
};
const row = async (id: number) =>
  ((await sql()`select pinned, flagged_at from idea_clusters where id = ${id}`) as { pinned: boolean; flagged_at: string | null }[])[0]!;
const proposals = async (id: number) =>
  (await sql()`select text, status from fact_proposals where kind = 'idea' and evidence_ids @> ${JSON.stringify([id])}::jsonb`) as { text: string; status: string }[];

const cleanup = async () => {
  const ids = (await sql()`select id from idea_clusters where title like ${MARK + "%"}`).map((r) => Number(r.id));
  await sql()`delete from fact_proposals where kind = 'idea' and (evidence_ids ->> 0)::bigint = any(${ids}::bigint[])`;
  await sql()`delete from idea_mentions where cluster_id = any(${ids}::bigint[])`;
  await sql()`delete from garden_events where cluster_id = any(${ids}::bigint[])`;
  await sql()`delete from idea_clusters where id = any(${ids}::bigint[])`;
};

describe.skipIf(!process.env.TEST_DATABASE_URL)("Top of Mind (real Neon)", () => {
  beforeEach(async () => {
    await cleanup();
    // test branch only: other suites' leftover pins would otherwise eat the cap
    await sql()`update idea_clusters set pinned = false where pinned`;
  });
  afterAll(cleanup);

  it("pins, queues one pending idea fact (switch on), stays idempotent, and unpinning drops the unsent fact", async () => {
    const id = await idea(1);
    expect(await setPinned(id, true, ON)).toEqual({ changed: true });
    expect(await setPinned(id, true, ON)).toEqual({ changed: false });
    expect((await row(id)).pinned).toBe(true);
    expect(await proposals(id)).toEqual([{ text: `Developing an idea: ${MARK} 1 (mentioned 2 times since Oct)`, status: "pending" }]);
    expect(await setPinned(id, false, ON)).toEqual({ changed: true });
    expect((await row(id)).pinned).toBe(false);
    expect(await proposals(id)).toEqual([]);
  });

  it("a fact the weekly writer already claimed survives the unpin; the switch off writes none", async () => {
    const id = await idea(2);
    await setPinned(id, true, ON);
    await sql()`update fact_proposals set write_started_at = now() where evidence_ids @> ${JSON.stringify([id])}::jsonb`;
    await setPinned(id, false, ON);
    expect(await proposals(id)).toHaveLength(1);
    const off = await idea(3);
    await setPinned(off, true, {});
    expect(await proposals(off)).toEqual([]);
  });

  it(`refuses a pin past ${PIN_CAP} live pins and never pins a dismissed idea`, async () => {
    for (let n = 0; n < PIN_CAP; n++) expect((await setPinned(await idea(10 + n), true, {})).changed).toBe(true);
    const extra = await idea(20);
    expect(await setPinned(extra, true, {})).toEqual({ changed: false, refused: `Top of Mind holds ${PIN_CAP} ideas. Unpin one to make room.` });
    expect((await row(extra)).pinned).toBe(false);
    const gone = await idea(21, { stage: "dismissed" });
    await sql()`update idea_clusters set pinned = false where title like ${MARK + "%"}`;
    expect(await setPinned(gone, true, {})).toEqual({ changed: false });
  });

  it("two pins at the same instant with 4 pinned make 5, never 6 (the advisory lock)", async () => {
    for (let n = 0; n < PIN_CAP - 1; n++) await setPinned(await idea(40 + n), true, {});
    const [a, b] = [await idea(50), await idea(51)];
    const results = await Promise.all([setPinned(a, true, {}), setPinned(b, true, {})]);
    expect(results.filter((r) => r.changed)).toHaveLength(1);
    const [{ n }] = (await sql()`select count(*)::int as n from idea_clusters where pinned and stage <> 'dismissed'`) as { n: number }[];
    expect(n).toBe(PIN_CAP);
  });

  it("unpinning an idea whose fact was already sent keeps the fact and says so", async () => {
    const id = await idea(60);
    await setPinned(id, true, ON);
    await sql()`update fact_proposals set bee_fact_id = 777001 where evidence_ids @> ${JSON.stringify([id])}::jsonb`;
    expect(await setPinned(id, false, ON)).toEqual({ changed: true, note: "Unpinned. Its Bee fact stays until you delete it in the Bee app." });
    expect(await proposals(id)).toHaveLength(1);
  });

  it("finds nearby pinned ideas only (within the distance, not dismissed) and flags a pinned idea when a mention joins it", async () => {
    const near = await idea(30, { centroid: vec(0) });
    const unpinned = await idea(31, { centroid: vec(0) });
    const far = await idea(32, { centroid: vec(500) });
    await setPinned(near, true, {});
    await setPinned(far, true, {});
    const found = (await pinnedClustersNear(vec(0))).map((c) => c.id);
    expect(found).toContain(near);
    expect(found).not.toContain(unpinned);
    expect(found).not.toContain(far);

    const join = (clusterId: number, conv: number): SaveItem => ({
      kind: "idea", route: "accept", extraction: { title: "t", excerpt: "a synthetic excerpt" },
      beeConversationId: conv, beeJournalId: null, spokenAt: new Date(), confidence: 0.9, source: "ambient",
      cluster: { action: "join", clusterId, embedding: vec(0), timelineNote: "again" },
    });
    const base = 8_300_000 + Math.floor(Math.random() * 10_000);
    await sql().transaction((txn) => [...buildSaveQueries(txn, join(near, base)), ...buildSaveQueries(txn, join(unpinned, base + 1))]);
    expect((await row(near)).flagged_at).not.toBeNull();
    expect((await row(unpinned)).flagged_at).toBeNull();
  });
});
