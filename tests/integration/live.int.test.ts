import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { BeeClient } from "../../agent/lib/bee/client";
import type { PipelineDeps } from "../../agent/lib/pipeline/process-conversation";
import type { SaveItem } from "../../agent/lib/pipeline/save-item";
import type { TriageResult } from "../../agent/lib/types";

// Real Neon test on the `test` branch: needs TEST_DATABASE_URL (never production). Skipped when absent.
// Every model dependency is a fake: no Gateway call from this file.
const RUN = Date.now() % 1_000_000_000;
const CONV = (n: number) => 9_400_000_000 + RUN * 10 + n;
const UUID = (n: number) => `it-live-occ-${RUN}-${n}`;
const DIM = 700 + (RUN % 300); // a direction no other test row uses, so nearest-cluster results are ours
const unit = (i: number) => Array.from({ length: 1536 }, (_, j) => (j === i ? 1 : 0));
// ~40 sequential Neon round trips per test (4 deliveries + a completed pass); the fetch guard below proves none is a model.
const SLOW = 30_000;
const LINES = ["so I keep coming back to", "a weekly segment about", "Milwaukee record stores", "on Saturday mornings"];

const idea = (over: Partial<Extract<SaveItem, { kind: "idea" }>>): Extract<SaveItem, { kind: "idea" }> => ({
  kind: "idea", route: "accept", extraction: { title: "IT: record store segment", excerpt: "a weekly segment about Milwaukee record stores" },
  beeConversationId: null, beeJournalId: null, spokenAt: new Date("2026-10-01T15:00:00Z"), confidence: 0.9, source: "ambient", ...over,
});
const tri = (): TriageResult => ({
  kind: "idea_by_user", kindProbability: 0.93, recType: "none", recTypeProbability: 0.9, jokingProbability: 0.02,
  broadcastProbability: 0.01, model: "fake", providerMetadata: null,
});
// The completed conversation as REST returns it, plus "no capturing conversation" for the live uuid lookup.
const fakeBee = (id: number) => ({
  listConversations: async () => ({ conversations: [] }),
  getConversation: async () => ({
    conversation: {
      id, state: "COMPLETED", start_time: Date.parse("2026-10-16T15:00:00Z"), summary: null, short_summary: null,
      transcriptions: [{ realtime: false, utterances: LINES.map((text, i) => ({ text, speaker: "Unknown", spoken_at: Date.parse("2026-10-16T15:00:00Z") + i * 1000 })) }],
    },
  }),
}) as unknown as BeeClient;
const deps = (id: number, clusterId: () => number | null): Partial<PipelineDeps> => ({
  bee: fakeBee(id),
  triage: async () => tri(),
  extractIdea: async () => ({ title: "IT: record store segment", excerpt: "a weekly segment about Milwaukee record stores" }),
  extractRecommendation: async () => { throw new Error("no recs here"); },
  now: () => new Date("2026-10-16T15:05:00Z"),
  compost: {
    embedText: async () => unit(DIM),
    chooseCluster: async (_i, options) => {
      const want = clusterId();
      const key = want !== null && options.some((o) => o.key === `c_${want}`) ? `c_${want}` : null;
      return { key };
    },
    writeTimelineNote: async () => "said it again",
  },
});

describe.skipIf(!process.env.TEST_DATABASE_URL)("live bloom and occasion identity on the Neon test branch", () => {
  const clusterIds: number[] = [];
  // Proof, not hope, that nothing here reaches a model: any request that is not to Neon fails the test.
  const realFetch = globalThis.fetch;
  const outside: string[] = [];
  beforeAll(() => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!/neon\.tech/.test(new URL(url).host)) {
        outside.push(new URL(url).host);
        throw new Error(`unexpected network call to ${new URL(url).host}`);
      }
      return realFetch(input, init);
    }) as typeof fetch;
  });
  afterEach(() => expect(outside).toEqual([]));
  const mods = async () => ({
    ...(await import("../../agent/lib/db")),
    ...(await import("../../agent/lib/pipeline/save-item")),
    ...(await import("../../agent/lib/pipeline/live")),
    ...(await import("../../agent/lib/pipeline/process-conversation")),
    ...(await import("../../agent/lib/store/conversations")),
    ...(await import("../../agent/lib/store/garden-events")),
    ...(await import("../../agent/lib/store/ideas")),
    ...(await import("../../agent/lib/ideas/stage")),
  });
  const save = async (item: SaveItem) => {
    const { db, buildSaveQueries, savedIds } = await mods();
    return savedIds([item], await db().transaction((txn) => buildSaveQueries(txn, item)));
  };
  const speak = async (uuid: string, d: Partial<PipelineDeps>) => {
    const { handleLiveUtterance } = await mods();
    const out = [];
    for (const [i, text] of LINES.entries()) out.push(await handleLiveUtterance({ conversationUuid: uuid, speaker: "Unknown", text, utteranceId: 1000 + i }, d));
    return out;
  };
  const state = async (id: number) => {
    const { db, getClusterTimeline } = await mods();
    const [c] = await db()`select mention_count, stage from idea_clusters where id = ${id}`;
    const events = await db()`select kind from garden_events where cluster_id = ${id} order by id`;
    const mentions = await db()`select bee_conversation_id, bee_conversation_uuid from idea_mentions where cluster_id = ${id} order by id`;
    return { ...c!, events: events.map((e) => e.kind), timeline: (await getClusterTimeline(id)).length, mentions };
  };
  const seed = async (n: number) => {
    const first = await save(idea({ beeConversationId: CONV(n), cluster: { action: "create", embedding: unit(DIM) } }));
    const id = first.ideaClusterIds[0]!;
    clusterIds.push(id);
    await save(idea({ beeConversationId: CONV(n + 1), cluster: { action: "join", clusterId: id, embedding: unit(DIM) } }));
    return id;
  };

  afterAll(async () => {
    globalThis.fetch = realFetch;
    const { db } = await mods();
    for (const id of clusterIds) await db()`delete from idea_clusters where id = ${id}`;
    await db()`delete from utterance_buffer where conversation_uuid like ${`it-live-occ-${RUN}-%`}`;
    await db()`delete from bee_conversation_map where conversation_uuid like ${`it-live-occ-${RUN}-%`}`;
    for (const n of [10, 20]) await db()`delete from processed_conversations where bee_conversation_id = ${CONV(n)}`;
  });

  it("a third mention spoken live blooms the cluster: event kinds follow isNewBloom on the returned stages", async () => {
    const { rememberConversationUuid, listGardenEventsSince } = await mods();
    const since = new Date(Date.now() - 60_000);
    const id = await seed(1); // two earlier occasions
    expect(await state(id)).toMatchObject({ mention_count: 2, stage: "sprouting", events: ["mention", "mention"] });
    await rememberConversationUuid(UUID(10), CONV(10)); // the new-conversation event arrived
    const out = await speak(UUID(10), deps(CONV(10), () => id));
    expect(out.map((o) => o.triaged)).toEqual([false, false, false, true]); // one window, at the 4th utterance
    expect(out[3]).toMatchObject({ windows: 1, ideas: 1, saved: { ideaClusterIds: [id], bloomedClusterIds: [id] } });
    expect(await state(id)).toMatchObject({
      mention_count: 3, stage: "ready", events: ["mention", "mention", "bloom"], timeline: 3,
      mentions: [
        { bee_conversation_id: String(CONV(1)), bee_conversation_uuid: null },
        { bee_conversation_id: String(CONV(2)), bee_conversation_uuid: null },
        { bee_conversation_id: String(CONV(10)), bee_conversation_uuid: UUID(10) },
      ],
    });
    const events = (await listGardenEventsSince(since)).filter((e) => e.clusterId === id);
    expect(events.at(-1)).toMatchObject({ kind: "bloom", title: "IT: record store segment", stage: "ready", mentionCount: 3 });

    // The completed pass of the SAME conversation: still one occasion — no 4th mention, no second timeline line.
    const { processConversation } = await mods();
    const r = await processConversation(CONV(10), deps(CONV(10), () => id));
    expect(r).toMatchObject({ skipped: false, ideas: 0 });
    expect(await state(id)).toMatchObject({ mention_count: 3, events: ["mention", "mention", "bloom"], timeline: 3 });

    // A fourth, separate occasion is a plain mention: ready → ready is not a new bloom.
    const fourth = await save(idea({ beeConversationId: CONV(11), cluster: { action: "join", clusterId: id, embedding: unit(DIM) } }));
    expect(fourth.bloomedClusterIds).toEqual([]);
    expect((await state(id)).events).toEqual(["mention", "mention", "bloom", "mention"]);
  }, SLOW);

  it("an unmapped stream uuid is still one occasion with the completed pass once the map learns the pair", async () => {
    const { rememberConversationUuid, processConversation, db, buildSaveQueries } = await mods();
    const id = await seed(3);
    const out = await speak(UUID(20), deps(CONV(20), () => id)); // no map row, and no capturing conversation holds it
    expect(out[3]).toMatchObject({ ideas: 1 });
    expect((await state(id)).mentions.at(-1)).toEqual({ bee_conversation_id: null, bee_conversation_uuid: UUID(20) });

    await rememberConversationUuid(UUID(20), CONV(20)); // e.g. a later new-conversation delivery
    const r = await processConversation(CONV(20), deps(CONV(20), () => id));
    expect(r).toMatchObject({ skipped: false, ideas: 0 });
    expect(await state(id)).toMatchObject({ mention_count: 3, timeline: 3, events: ["mention", "mention", "bloom"] });

    // Even past the planner, the database refuses it: the save fills the uuid from the map and hits the unique index.
    const sneak = idea({ beeConversationId: CONV(20), cluster: { action: "join", clusterId: id, embedding: unit(DIM) } });
    await expect(db().transaction((txn) => buildSaveQueries(txn, sneak))).rejects.toThrow(/idea_mentions_cluster_uuid_uniq/);
  }, SLOW);
});
