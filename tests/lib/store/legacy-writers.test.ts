import { beforeEach, describe, expect, it, vi } from "vitest";

// Fake Neon: records plain queries and transaction statements.
const ran: { sql: string; params: unknown[]; inTxn: boolean }[] = [];
const tag = (inTxn: boolean) => (strings: TemplateStringsArray, ...params: unknown[]) => {
  const q = { sql: strings.join("?"), params, inTxn };
  ran.push(q);
  return q;
};
vi.mock("../../../agent/lib/db", () => ({
  db: () => Object.assign(
    async (strings: TemplateStringsArray, ...params: unknown[]) => (tag(false)(strings, ...params), [{ id: 7, cluster_id: 9 }]),
    { transaction: async (fn: (t: unknown) => unknown[]) => fn(tag(true)).map(() => [{ id: 7, cluster_id: 9 }]) },
  ),
}));

import { createClusterWithMention } from "../../../agent/lib/store/ideas";
import { insertRecommendation } from "../../../agent/lib/store/recommendations";

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
const long = (params: unknown[]) => params.filter((p): p is string => typeof p === "string" && p.startsWith("w0 "));

beforeEach(() => {
  ran.length = 0;
});

describe("legacy store writers stay in line with buildSaveQueries", () => {
  it("createClusterWithMention saves through buildSaveQueries (clamped excerpt, one transaction)", async () => {
    const r = await createClusterWithMention({
      title: "House music segment", beeConversationId: 1, beeJournalId: null, excerpt: words(40),
      spokenAt: new Date("2026-10-16T12:00:00Z"), confidence: 0.9, reviewStatus: "accepted", source: "ambient",
    });
    expect(r).toEqual({ clusterId: 9, mentionId: 7 });
    expect(ran).toHaveLength(1);
    expect(ran[0]!.inTxn).toBe(true);
    expect(ran[0]!.sql).toContain("insert into idea_clusters");
    for (const p of long(ran[0]!.params)) expect(p.split(" ")).toHaveLength(25);
    expect(long(ran[0]!.params).length).toBeGreaterThan(0);
  });

  it("insertRecommendation clamps excerpt and raw_text to 25 words like buildSaveQueries", async () => {
    await insertRecommendation({
      type: "place", rawText: words(60), canonicalName: "Ardent", creator: null, recommenderId: null, attributionSource: "none",
      excerpt: words(40), beeConversationId: 1, beeJournalId: null, saidAt: new Date(), source: "ambient", status: "new", confidence: 0.9,
    });
    const texts = long(ran[0]!.params);
    expect(texts).toHaveLength(2);
    for (const p of texts) expect(p.split(" ")).toHaveLength(25);
  });
});
