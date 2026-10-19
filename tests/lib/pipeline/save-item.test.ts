import { describe, expect, it } from "vitest";
import { buildSaveQueries, recStatusAtSave, savedIds, type SaveItem } from "../../../agent/lib/pipeline/save-item";
import type { Txn } from "../../../agent/lib/store/conversations";

const txn = ((strings: TemplateStringsArray, ...params: unknown[]) => ({ sql: strings.join("?"), params })) as unknown as Txn;
const one = (item: SaveItem) => {
  const qs = buildSaveQueries(txn, item) as unknown as { sql: string; params: unknown[] }[];
  expect(qs).toHaveLength(1); // savedIds relies on exactly one statement per item
  return qs[0]!;
};

const idea = (over: Partial<Extract<SaveItem, { kind: "idea" }>> = {}): SaveItem => ({
  kind: "idea", route: "accept", extraction: { title: "House music segment", excerpt: "what if we did" },
  beeConversationId: 42, beeJournalId: null, spokenAt: new Date("2026-10-16T12:00:00Z"), confidence: 0.9, source: "ambient", ...over,
});

describe("buildSaveQueries for ideas", () => {
  it("create plan: a new cluster whose centroid and mention carry the embedding", () => {
    const q = one(idea({ cluster: { action: "create", embedding: [0.5, -1] } }));
    expect(q.sql).toContain("insert into idea_clusters");
    expect(q.sql).toMatch(/centroid/);
    expect(q.params.filter((p) => p === "[0.5,-1]")).toHaveLength(2);
    expect(q.sql).toMatch(/returning id, cluster_id/);
  });

  it("create plan without an embedding (fallback) stores null vectors", () => {
    const q = one(idea({ cluster: { action: "create", embedding: null } }));
    expect(q.sql).toContain("insert into idea_clusters");
    expect(q.params.filter((p) => p === null).length).toBeGreaterThanOrEqual(2);
  });

  it("join plan: adds a mention to the chosen cluster and updates count, dates, centroid mean and stage in one statement", () => {
    const q = one(idea({ cluster: { action: "join", clusterId: 12, embedding: [0.5, -1] } }));
    expect(q.sql).not.toContain("insert into idea_clusters");
    expect(q.sql).toContain("insert into idea_mentions");
    expect(q.sql).toContain("update idea_clusters");
    expect(q.sql).toMatch(/mention_count = mention_count \+ 1/);
    expect(q.sql).toMatch(/avg\(/);
    expect(q.sql).toMatch(/idea_stage_for\(stage, mention_count \+ 1\)/);
    expect(q.sql).toMatch(/last_mentioned_at = greatest/);
    expect(q.sql).toMatch(/returning id, cluster_id/);
    expect(q.params).toContain(12);
    expect(q.params).toContain("[0.5,-1]");
    expect(q.params).toContain("accepted");
  });

  it("join plan flags a pinned (Top of Mind) idea at once; an unpinned one keeps its flag as it was", () => {
    const q = one(idea({ cluster: { action: "join", clusterId: 12, embedding: [1] } }));
    expect(q.sql).toContain("flagged_at = case when pinned then now() else flagged_at end");
  });

  it("join plan clamps the excerpt to 25 words like every save", () => {
    const long = Array.from({ length: 40 }, (_, i) => `w${i}`).join(" ");
    const q = one(idea({ extraction: { title: "t", excerpt: long }, cluster: { action: "join", clusterId: 12, embedding: [1] } }));
    const texts = q.params.filter((p): p is string => typeof p === "string" && p.startsWith("w0 "));
    expect(texts).toHaveLength(1);
    expect(texts[0]!.split(" ")).toHaveLength(25);
  });

  it("a needs_review idea counts (Tarik's rule): a create starts at mention_count 1, the mention stays needs_review", () => {
    const q = one(idea({ route: "review", cluster: { action: "create", embedding: [1] } }));
    expect(q.sql).toContain("insert into idea_clusters");
    expect(q.params).toContain(1);
    expect(q.params).not.toContain(0);
    expect(q.params).toContain("needs_review");
    expect(q.params.filter((p) => p === "[1]")).toHaveLength(2);
  });

  it("a needs_review idea joining a cluster increments its count and keeps review_status needs_review", () => {
    const q = one(idea({ route: "review", cluster: { action: "join", clusterId: 12, embedding: [1] } }));
    expect(q.sql).toMatch(/mention_count = mention_count \+ 1/);
    expect(q.params).toContain("needs_review");
    expect(q.params).not.toContain("accepted");
  });

  it("join plan returns the previous and new stage and writes its garden event in the same statement", () => {
    const q = one(idea({ cluster: { action: "join", clusterId: 12, embedding: [1] } }));
    expect(q.sql).toMatch(/returning old\.stage as prev_stage, new\.stage as next_stage/);
    expect(q.sql).toContain("insert into garden_events");
    expect(q.sql).toMatch(/when c\.prev_stage <> 'ready' and c\.next_stage = 'ready' then 'bloom' else 'mention'/);
    expect(q.sql).toMatch(/select m\.id, m\.cluster_id, c\.prev_stage, c\.next_stage/);
  });

  it("create plan writes a 'mention' garden event (a new cluster never blooms) and reports stage compost", () => {
    const q = one(idea({ cluster: { action: "create", embedding: [1] } }));
    expect(q.sql).toContain("insert into garden_events");
    expect(q.sql).toMatch(/'mention'/);
    expect(q.sql).not.toMatch(/'bloom'/);
    expect(q.sql).toMatch(/null::text as prev_stage, 'compost'::text as next_stage/);
  });

  it.each(["create", "join"] as const)("%s: stores the stream uuid and fills either missing conversation form from bee_conversation_map", (action) => {
    const cluster = action === "join" ? { action, clusterId: 12, embedding: [1] } : { action, embedding: [1] };
    const q = one(idea({ beeConversationId: null, beeConversationUuid: "uuid-1", cluster }));
    expect(q.sql).toContain("bee_conversation_uuid");
    expect(q.sql).toMatch(/coalesce\(\?::bigint, \(select bee_conversation_id from bee_conversation_map where conversation_uuid = \?::text\)\)/);
    expect(q.sql).toMatch(/coalesce\(\?::text, \(select conversation_uuid from bee_conversation_map where bee_conversation_id = \?::bigint\)\)/);
    expect(q.params.filter((p) => p === "uuid-1")).toHaveLength(2);
  });

  it("the centroid mean uses every non-dismissed mention (accepted and needs_review alike)", () => {
    const q = one(idea({ cluster: { action: "join", clusterId: 12, embedding: [1] } }));
    expect(q.sql).toMatch(/review_status <> 'dismissed'/);
    expect(q.sql).not.toMatch(/review_status = 'accepted'/);
  });
});

describe("savedIds", () => {
  it("reports a bloom only for an idea whose stage just became ready (isNewBloom on the returned stages)", () => {
    const items = [idea(), idea(), idea()];
    const results = [
      [{ id: 1, cluster_id: 10, prev_stage: "sprouting", next_stage: "ready" }],
      [{ id: 2, cluster_id: 11, prev_stage: "ready", next_stage: "ready" }],
      [{ id: 3, cluster_id: 12, prev_stage: null, next_stage: "compost" }],
    ];
    expect(savedIds(items, results)).toEqual({ recIds: [], ideaClusterIds: [10, 11, 12], mentionIds: [1, 2, 3], bloomedClusterIds: [10] });
  });
});

// Decision 052: an overheard tip nobody recommended goes to Heard nearby ('overheard'), whatever its band.
describe("buildSaveQueries for recs: the status a tip is saved with", () => {
  const rec = (over: Partial<Extract<SaveItem, { kind: "rec" }>> = {}): Extract<SaveItem, { kind: "rec" }> => ({
    kind: "rec", route: "accept", recType: "album", extraction: { canonicalName: "Promises", creator: "Floating Points", excerpt: "you should hear Promises" } as never,
    attribution: { firstName: null, source: "none" },
    beeConversationId: 42, beeJournalId: null, spokenAt: new Date("2026-10-16T12:00:00Z"), confidence: 0.95, source: "ambient", ...over,
  });
  const ann = { firstName: "Ann", source: "second_person" } as const;

  it.each(["accept", "review"] as const)("overheard, no person, %s band: 'overheard'", (route) => {
    expect(recStatusAtSave(rec({ route }))).toBe("overheard");
    expect(one(rec({ route })).params).toContain("overheard");
  });

  it.each([["accept", "new"], ["review", "needs_review"]] as const)("overheard with a person, %s band: %s as before", (route, status) => {
    expect(recStatusAtSave(rec({ route, attribution: ann }))).toBe(status);
    expect(one(rec({ route, attribution: ann })).params).toContain(status);
  });

  it("deliberate captures with no person keep today's status: 'Earmark that', a voice note, a journal", () => {
    expect(recStatusAtSave(rec({ deliberateKey: "u-9" }))).toBe("new");
    expect(recStatusAtSave(rec({ route: "review", deliberateKey: "u-9" }))).toBe("needs_review");
    expect(recStatusAtSave(rec({ source: "voice" }))).toBe("new");
    expect(recStatusAtSave(rec({ beeJournalId: "j-1", beeConversationId: null }))).toBe("new");
    expect(recStatusAtSave(rec({ source: "email" }))).toBe("new");
  });
});
