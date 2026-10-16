import { afterAll, describe, expect, it } from "vitest";
import type { SaveItem } from "../../agent/lib/pipeline/save-item";

// Real Neon test on the `test` branch: needs TEST_DATABASE_URL (never production). Skipped when absent.
const RUN = Date.now() % 1_000_000_000;
const CONV = (n: number) => 9_200_000_000 + RUN * 10 + n;
const DIM = 1100 + (RUN % 300);
const unit = (i: number) => Array.from({ length: 1536 }, (_, j) => (j === i ? 1 : 0));

const idea = (over: Partial<Extract<SaveItem, { kind: "idea" }>>): Extract<SaveItem, { kind: "idea" }> => ({
  kind: "idea", route: "accept", extraction: { title: "IT: timeline idea", excerpt: "a segment about timelines" },
  beeConversationId: null, beeJournalId: null, spokenAt: new Date("2026-10-03T15:00:00Z"), confidence: 0.9, source: "ambient", ...over,
});

describe.skipIf(!process.env.TEST_DATABASE_URL)("idea timeline on the Neon test branch", () => {
  const clusterIds: number[] = [];
  const mods = async () => ({
    ...(await import("../../agent/lib/db")),
    ...(await import("../../agent/lib/pipeline/save-item")),
    ...(await import("../../agent/lib/store/ideas")),
    ...(await import("../../agent/lib/ideas/compost")),
  });
  const save = async (item: SaveItem) => {
    const { db, buildSaveQueries, savedIds } = await mods();
    return savedIds([item], await db().transaction((txn) => buildSaveQueries(txn, item)));
  };

  afterAll(async () => {
    const { db } = await mods();
    for (const id of clusterIds) await db()`delete from idea_clusters where id = ${id}`;
  });

  it("create and join each append exactly one line, dated by the mention's own time (America/Chicago), in order", async () => {
    const { getClusterTimeline } = await mods();
    const first = await save(idea({
      beeConversationId: CONV(1), cluster: { action: "create", embedding: unit(DIM), timelineNote: "first idea, said out loud" },
    }));
    const id = first.ideaClusterIds[0]!;
    clusterIds.push(id);
    expect(await getClusterTimeline(id)).toEqual([{ date: "2026-10-03T15:00:00.000Z", line: "Oct 3: first idea, said out loud" }]);

    await save(idea({
      beeConversationId: CONV(2), spokenAt: new Date("2026-10-12T03:00:00Z"),
      cluster: { action: "join", clusterId: id, embedding: unit(DIM), timelineNote: "added a radio segment angle" },
    }));
    // A review-band mention counts too (decision 004). No timelineNote: the code fallback.
    await save(idea({
      route: "review", confidence: 0.7, beeConversationId: CONV(3), spokenAt: new Date("2026-10-14T15:00:00Z"),
      cluster: { action: "join", clusterId: id, embedding: unit(DIM) },
    }));
    expect((await getClusterTimeline(id)).map((e) => e.line)).toEqual([
      "Oct 3: first idea, said out loud",
      "Oct 11: added a radio segment angle", // 10 pm CDT on Oct 11 (03:00Z Oct 12), never "now"
      "Oct 14: mentioned again",
    ]);
  });

  it("the CREATE path also dates in Chicago: 03:00Z is the previous day, and a CST 05:30Z on Nov 10 is Nov 9", async () => {
    const { getClusterTimeline } = await mods();
    for (const [n, at, want] of [[6, "2026-10-03T03:00:00Z", "Oct 2: n"], [7, "2026-11-10T05:30:00Z", "Nov 9: n"]] as const) {
      const r = await save(idea({ beeConversationId: CONV(n), spokenAt: new Date(at), cluster: { action: "create", embedding: unit(DIM + n), timelineNote: "n" } }));
      clusterIds.push(r.ideaClusterIds[0]!);
      expect((await getClusterTimeline(r.ideaClusterIds[0]!)).map((e) => e.line)).toEqual([want]);
    }
  });

  it("a legacy create with no plan still gets its 'first heard' line", async () => {
    const { getClusterTimeline } = await mods();
    const r = await save(idea({ beeConversationId: CONV(4) }));
    clusterIds.push(r.ideaClusterIds[0]!);
    expect((await getClusterTimeline(r.ideaClusterIds[0]!)).map((e) => e.line)).toEqual(["Oct 3: first heard"]);
  });

  it("a duplicate from the same occasion is dropped by the plan, so the timeline gets no extra line", async () => {
    const { planIdeaClusters, getClusterTimeline } = await mods();
    const id = clusterIds[0]!;
    const deps = {
      embedText: async () => unit(DIM),
      chooseCluster: async () => ({ key: `c_${id}`, choice: `c_${id}`, probability: 0.9 }),
      writeTimelineNote: async () => "should never be written",
    };
    const before = await getClusterTimeline(id);
    const planned = await planIdeaClusters([idea({ beeConversationId: CONV(2) })], deps); // CONV(2) already counted
    expect(planned).toEqual([]);
    expect(await getClusterTimeline(id)).toEqual(before);

    // A fresh occasion plans a join carrying the model note, and saving it appends exactly one line.
    const fresh = await planIdeaClusters([idea({ beeConversationId: CONV(5), spokenAt: new Date("2026-10-15T15:00:00Z") })], {
      ...deps, writeTimelineNote: async () => "named three possible guests",
    });
    expect(fresh).toHaveLength(1);
    await save(fresh[0]!);
    const after = await getClusterTimeline(id);
    expect(after).toHaveLength(before.length + 1);
    expect(after.at(-1)!.line).toBe("Oct 15: named three possible guests");
  });
});
