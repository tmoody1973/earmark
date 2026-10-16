import { describe, expect, it } from "vitest";
import { buildSaveQueries, type SaveItem } from "../../../agent/lib/pipeline/save-item";
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

  it("the centroid mean uses every non-dismissed mention (accepted and needs_review alike)", () => {
    const q = one(idea({ cluster: { action: "join", clusterId: 12, embedding: [1] } }));
    expect(q.sql).toMatch(/review_status <> 'dismissed'/);
    expect(q.sql).not.toMatch(/review_status = 'accepted'/);
  });
});
