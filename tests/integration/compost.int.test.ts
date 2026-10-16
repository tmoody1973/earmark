import { afterAll, describe, expect, it } from "vitest";
import type { SaveItem } from "../../agent/lib/pipeline/save-item";

// Real Neon test on the `test` branch: needs TEST_DATABASE_URL (never production). Skipped when absent.
// Run: pnpm test:int
const RUN = Date.now() % 1_000_000_000;
const CONV = (n: number) => 9_100_000_000 + RUN * 10 + n;
const JOURNAL = `it-compost-${RUN}`;
const DIM = 400 + (RUN % 1000); // a direction no other test row uses, so nearest-cluster results are ours
const unit = (i: number) => Array.from({ length: 1536 }, (_, j) => (j === i ? 1 : 0));

const idea = (over: Partial<Extract<SaveItem, { kind: "idea" }>>): Extract<SaveItem, { kind: "idea" }> => ({
  kind: "idea", route: "accept", extraction: { title: "IT: AI newsletter", excerpt: "a newsletter about AI in public radio" },
  beeConversationId: null, beeJournalId: null, spokenAt: new Date("2026-10-01T15:00:00Z"), confidence: 0.9, source: "ambient", ...over,
});

describe.skipIf(!process.env.TEST_DATABASE_URL)("idea compost on the Neon test branch", () => {
  const clusterIds: number[] = [];
  const mods = async () => ({
    ...(await import("../../agent/lib/db")),
    ...(await import("../../agent/lib/pipeline/save-item")),
    ...(await import("../../agent/lib/store/ideas")),
    ...(await import("../../agent/lib/ideas/stage")),
    ...(await import("../../agent/lib/ideas/compost")),
  });
  const save = async (item: SaveItem) => {
    const { db, buildSaveQueries, savedIds } = await mods();
    return savedIds([item], await db().transaction((txn) => buildSaveQueries(txn, item)));
  };
  const cluster = async (id: number) => {
    const { db } = await mods();
    const [row] = await db()`select mention_count, stage, subvector(centroid, ${DIM + 1}, 2)::text as head,
                                    first_mentioned_at, last_mentioned_at from idea_clusters where id = ${id}`;
    return row!;
  };

  afterAll(async () => {
    const { db } = await mods();
    for (const id of clusterIds) await db()`delete from idea_clusters where id = ${id}`;
  });

  it("create → join → join grows compost → sprouting → ready, with a mean centroid and widened dates", async () => {
    const first = await save(idea({ beeConversationId: CONV(1), cluster: { action: "create", embedding: unit(DIM) } }));
    const id = first.ideaClusterIds[0]!;
    clusterIds.push(id);
    expect(await cluster(id)).toMatchObject({ mention_count: 1, stage: "compost", head: "[1,0]" });

    const second = await save(idea({
      beeConversationId: CONV(2), spokenAt: new Date("2026-10-03T15:00:00Z"), cluster: { action: "join", clusterId: id, embedding: unit(DIM + 1) },
    }));
    expect(second.ideaClusterIds).toEqual([id]);
    expect(second.mentionIds).toHaveLength(1);
    expect(await cluster(id)).toMatchObject({ mention_count: 2, stage: "sprouting", head: "[0.5,0.5]" });

    await save(idea({
      beeConversationId: null, beeJournalId: JOURNAL, source: "voice", confidence: 1, spokenAt: new Date("2026-09-30T15:00:00Z"),
      cluster: { action: "join", clusterId: id, embedding: unit(DIM) },
    }));
    const c = await cluster(id);
    expect(c).toMatchObject({ mention_count: 3, stage: "ready" });
    expect(c.head).toMatch(/^\[0\.6666\d*,0\.3333\d*\]$/);
    expect(new Date(c.first_mentioned_at as string).toISOString()).toBe("2026-09-30T15:00:00.000Z");
    expect(new Date(c.last_mentioned_at as string).toISOString()).toBe("2026-10-03T15:00:00.000Z");
  });

  it("never downgrades a drafted idea when it is mentioned again", async () => {
    const { db } = await mods();
    const id = clusterIds[0]!;
    await db()`update idea_clusters set stage = 'drafted' where id = ${id}`;
    await save(idea({ beeConversationId: CONV(4), cluster: { action: "join", clusterId: id, embedding: unit(DIM) } }));
    expect(await cluster(id)).toMatchObject({ mention_count: 4, stage: "drafted" });
  });

  it("the SQL stage rule matches stageFor", async () => {
    const { db, stageFor } = await mods();
    const stages = ["compost", "sprouting", "ready", "drafted", "used", "dismissed"] as const;
    // One round trip for all 30 cases.
    const rows = await db()`select s, n, idea_stage_for(s, n) as stage
                            from unnest(${stages}::text[]) s cross join generate_series(0, 4) n`;
    expect(rows).toHaveLength(stages.length * 5);
    for (const r of rows) expect(r.stage, `${r.s} at ${r.n}`).toBe(stageFor(r.s as (typeof stages)[number], Number(r.n)));
  });

  it("finds the cluster as a nearest candidate, with its latest accepted excerpt", async () => {
    const { nearestClusters } = await mods();
    const near = await nearestClusters(unit(DIM), 5);
    const mine = near.find((c) => c.id === clusterIds[0]);
    expect(mine).toMatchObject({ title: "IT: AI newsletter", excerpt: "a newsletter about AI in public radio", pinned: false, mentionCount: 4 });
    expect(mine!.distance).toBeLessThan(0.2);
  });

  it("knows which conversations and journals already mentioned a cluster", async () => {
    const { hasMentionFromSameOccasion } = await mods();
    const id = clusterIds[0]!;
    expect(await hasMentionFromSameOccasion(id, { beeConversationId: CONV(1), beeJournalId: null })).toBe(true);
    expect(await hasMentionFromSameOccasion(id, { beeConversationId: null, beeJournalId: JOURNAL })).toBe(true);
    expect(await hasMentionFromSameOccasion(id, { beeConversationId: CONV(9), beeJournalId: null })).toBe(false);
    expect(await hasMentionFromSameOccasion(id, { beeConversationId: null, beeJournalId: null })).toBe(false);
  });

  it("planIdeaClusters against the real store: joins the cluster Jev picks, drops a repeat from the same conversation", async () => {
    const { planIdeaClusters } = await mods();
    const id = clusterIds[0]!;
    const deps = {
      embedText: async () => unit(DIM),
      chooseCluster: async (_i: unknown, options: { key: string }[]) => {
        const key = `c_${id}`;
        expect(options.map((o) => o.key)).toContain(key);
        return { key, choice: key, probability: 0.9 };
      },
    };
    const fresh = await planIdeaClusters([idea({ beeConversationId: CONV(5) })], deps);
    expect(fresh).toEqual([expect.objectContaining({ cluster: { action: "join", clusterId: id, embedding: unit(DIM) } })]);
    expect(await planIdeaClusters([idea({ beeConversationId: CONV(2) })], deps)).toEqual([]); // CONV(2) already counted
  });

  it("review-band ideas count: needs_review mentions grow the cluster, which stays unconfirmed until an accepted mention joins", async () => {
    const { isClusterConfirmed } = await mods();
    const review = { route: "review" as const, confidence: 0.7 };
    const r = await save(idea({ ...review, beeConversationId: CONV(11), cluster: { action: "create", embedding: unit(DIM + 2) } }));
    const id = r.ideaClusterIds[0]!;
    clusterIds.push(id);
    expect(await cluster(id)).toMatchObject({ mention_count: 1, stage: "compost" });
    await save(idea({ ...review, beeConversationId: CONV(12), cluster: { action: "join", clusterId: id, embedding: unit(DIM + 2) } }));
    expect(await cluster(id)).toMatchObject({ mention_count: 2, stage: "sprouting" });
    expect(await isClusterConfirmed(id)).toBe(false);
    await save(idea({ beeConversationId: CONV(13), cluster: { action: "join", clusterId: id, embedding: unit(DIM + 2) } }));
    expect(await cluster(id)).toMatchObject({ mention_count: 3, stage: "ready" });
    expect(await isClusterConfirmed(id)).toBe(true);
    const { db } = await mods();
    const statuses = await db()`select review_status, count(*)::int as n from idea_mentions where cluster_id = ${id} group by 1 order by 1`;
    expect(statuses).toEqual([{ review_status: "accepted", n: 1 }, { review_status: "needs_review", n: 2 }]);
  });

  it("dismissed stays dismissed: a dismissed cluster is a candidate, a new mention is recorded and counted, the stage does not move", async () => {
    const { db, nearestClusters } = await mods();
    const r = await save(idea({ beeConversationId: CONV(21), cluster: { action: "create", embedding: unit(DIM + 3) } }));
    const id = r.ideaClusterIds[0]!;
    clusterIds.push(id);
    await db()`update idea_clusters set stage = 'dismissed' where id = ${id}`;
    expect((await nearestClusters(unit(DIM + 3), 5)).find((c) => c.id === id)).toMatchObject({ stage: "dismissed" });
    for (const n of [22, 23, 24]) {
      await save(idea({ beeConversationId: CONV(n), cluster: { action: "join", clusterId: id, embedding: unit(DIM + 3) } }));
    }
    expect(await cluster(id)).toMatchObject({ mention_count: 4, stage: "dismissed" });
  });

  it("one mention per occasion is enforced by the database: a second join from the same conversation fails and the transaction rolls back", async () => {
    const { db, buildSaveQueries } = await mods();
    const id = clusterIds[0]!;
    const before = await cluster(id);
    const item = idea({ beeConversationId: CONV(31), cluster: { action: "join", clusterId: id, embedding: unit(DIM) } });
    await expect(db().transaction((txn) => [...buildSaveQueries(txn, item), ...buildSaveQueries(txn, item)])).rejects.toThrow();
    expect(await cluster(id)).toMatchObject({ mention_count: before.mention_count });
    expect(await db()`select 1 from idea_mentions where bee_conversation_id = ${CONV(31)}`).toHaveLength(0);

    const voice = idea({ beeConversationId: null, beeJournalId: JOURNAL, source: "voice", cluster: { action: "join", clusterId: id, embedding: unit(DIM) } });
    await expect(db().transaction((txn) => buildSaveQueries(txn, voice))).rejects.toThrow(); // JOURNAL already joined in test 1
  });

  it("a fallback create without an embedding has no centroid, so it is never a nearest candidate", async () => {
    const { nearestClusters } = await mods();
    const r = await save(idea({ beeConversationId: CONV(6), cluster: { action: "create", embedding: null } }));
    clusterIds.push(r.ideaClusterIds[0]!);
    expect(await cluster(r.ideaClusterIds[0]!)).toMatchObject({ mention_count: 1, stage: "compost", head: null });
    expect((await nearestClusters(unit(DIM), 50)).map((c) => c.id)).not.toContain(r.ideaClusterIds[0]);
  });
});
