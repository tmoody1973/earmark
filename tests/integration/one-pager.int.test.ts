import { afterAll, describe, expect, it, vi } from "vitest";
import type { SaveItem } from "../../agent/lib/pipeline/save-item";

// Real Neon test on the `test` branch: needs TEST_DATABASE_URL (never production). Skipped when absent.
// Model and Bee deps are fakes: no Gateway or Bee call. Run: pnpm test:int
const RUN = Date.now() % 1_000_000_000;
const CONV = (n: number) => 9_200_000_000 + RUN * 10 + n;
const unit = (i: number) => Array.from({ length: 1536 }, (_, j) => (j === i ? 1 : 0));
const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");

const mention = (over: Partial<Extract<SaveItem, { kind: "idea" }>>): Extract<SaveItem, { kind: "idea" }> => ({
  kind: "idea", route: "review", extraction: { title: "IT: CRM for public radio", excerpt: "a CRM for public radio stations" },
  beeConversationId: null, beeJournalId: null, spokenAt: new Date("2026-10-01T15:00:00Z"), confidence: 0.7, source: "ambient", ...over,
});

const fakes = () => ({
  bee: {
    neuralSearch: vi.fn(async () => ({ results: [{ id: 1, locations: [], short_summary: "Talked about station tools" }] })),
    keywordSearch: vi.fn(async () => ({ results: [{ id: "f1", type: "fact", summary: "Works in public radio" }] })),
  },
  gateContext: vi.fn(async (i: { related: string[]; facts: string[] }) => ({ related: i.related, facts: i.facts, probabilities: { related: [], facts: [] } })),
  chooseDraftFormat: vi.fn(async () => ({ format: "product_brief" as const, probability: 0.9 })),
  writeOnePager: vi.fn(async () => `# CRM\n\n## Problem\n"${words(30)}"\n\n${words(320)}`),
});

describe.skipIf(!process.env.TEST_DATABASE_URL)("one-pager drafting on the Neon test branch", () => {
  const clusterIds: number[] = [];
  const mods = async () => ({
    ...(await import("../../agent/lib/db")),
    ...(await import("../../agent/lib/pipeline/save-item")),
    ...(await import("../../agent/lib/store/ideas")),
    ...(await import("../../agent/lib/ideas/one-pager")),
  });

  // Bloom through the real join path: create, then two joins from two more occasions (all needs_review: unconfirmed).
  async function bloomedCluster(base: number): Promise<number> {
    const { db, buildSaveQueries, savedIds } = await mods();
    const save = async (item: SaveItem) => savedIds([item], await db().transaction((txn) => buildSaveQueries(txn, item)));
    const first = await save(mention({ beeConversationId: CONV(base), spokenAt: new Date("2026-10-15T15:00:00Z"), cluster: { action: "create", embedding: unit(base) } }));
    const id = first.ideaClusterIds[0]!;
    clusterIds.push(id);
    await save(mention({ beeConversationId: CONV(base + 1), spokenAt: new Date("2026-09-12T15:00:00Z"), cluster: { action: "join", clusterId: id, embedding: unit(base) } }));
    const third = await save(mention({ beeConversationId: CONV(base + 2), spokenAt: new Date("2026-10-03T15:00:00Z"), cluster: { action: "join", clusterId: id, embedding: unit(base) } }));
    expect(third.bloomedClusterIds).toEqual([id]);
    return id;
  }
  const row = async (id: number) => {
    const { db } = await mods();
    const [r] = await db()`select stage, draft_md, draft_format, draft_attempts, draft_claimed_at from idea_clusters where id = ${id}`;
    return r!;
  };

  afterAll(async () => {
    const { db } = await mods();
    for (const id of clusterIds) await db()`delete from idea_clusters where id = ${id}`;
  });

  it("drafts an unconfirmed bloomed cluster once: draft + format + stage 'drafted' saved together; a re-run is a no-op", async () => {
    const id = await bloomedCluster(10);
    const { draftBlooms, getClusterForDraft } = await mods();

    const c = await getClusterForDraft(id);
    expect(c?.mentions).toHaveLength(3);
    expect(c?.timeline).toHaveLength(3);

    const d = fakes();
    const out = await draftBlooms({ clusterIds: [id], deps: d as never });
    expect(out).toHaveLength(1);
    expect(out[0]!.draft.startsWith("Mentioned 3 times: Sep 12 · Oct 3 · Oct 15\n\n# CRM")).toBe(true);
    // Timeline lines arrive sorted by date although stored in processing order.
    expect((d.writeOnePager.mock.calls[0] as unknown as [{ timelineLines: string[] }])[0].timelineLines.map((l) => l.slice(0, 6)))
      .toEqual(["Sep 12", "Oct 3:", "Oct 15"]);
    expect(await row(id)).toMatchObject({ stage: "drafted", draft_md: out[0]!.draft, draft_format: "product_brief", draft_attempts: 1, draft_claimed_at: null });

    expect(await draftBlooms({ clusterIds: [id], deps: d as never })).toEqual([]);
    expect(d.writeOnePager).toHaveBeenCalledTimes(1);
  });

  it("two runners at once draft a cluster exactly once", async () => {
    const id = await bloomedCluster(20);
    const { draftBlooms } = await mods();
    const d = fakes();
    const [a, b] = await Promise.all([draftBlooms({ clusterIds: [id], deps: d as never }), draftBlooms({ clusterIds: [id], deps: d as never })]);
    expect(a.length + b.length).toBe(1);
    expect(d.writeOnePager).toHaveBeenCalledTimes(1);
  });

  it("a failed draft leaves it bloomed without a draft, retried until MAX_DRAFT_ATTEMPTS, then left alone", async () => {
    const id = await bloomedCluster(30);
    const { draftBlooms, MAX_DRAFT_ATTEMPTS } = await mods();
    const d = fakes();
    d.writeOnePager.mockRejectedValue(Object.assign(new Error("x"), { name: "AI_APICallError" }));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    for (let i = 1; i <= MAX_DRAFT_ATTEMPTS; i++) {
      expect(await draftBlooms({ clusterIds: [id], deps: d as never })).toEqual([]);
      expect(await row(id)).toMatchObject({ stage: "ready", draft_md: null, draft_attempts: i, draft_claimed_at: null });
    }
    await draftBlooms({ clusterIds: [id], deps: d as never });
    expect(d.writeOnePager).toHaveBeenCalledTimes(MAX_DRAFT_ATTEMPTS);
    expect(JSON.stringify(err.mock.calls)).toContain(`[draft] cluster=${id} gave up after ${MAX_DRAFT_ATTEMPTS} attempts`);

    // scripts/draft-one-pager.ts --reset: attempts back to 0, claim cleared, claimable again.
    const { resetDraftAttempts, claimDraftableClusters } = await mods();
    await resetDraftAttempts(id);
    expect(await row(id)).toMatchObject({ draft_attempts: 0, draft_claimed_at: null });
    expect(await claimDraftableClusters({ clusterIds: [id], limit: 1 })).toEqual([{ id, attempts: 1 }]);
    err.mockRestore();
  });

  it("a live claim blocks other runners; a stale one (crashed run, older than the lease) is re-taken", async () => {
    const id = await bloomedCluster(40);
    const { db, claimDraftableClusters } = await mods();
    expect(await claimDraftableClusters({ clusterIds: [id], limit: 1 })).toEqual([{ id, attempts: 1 }]);
    expect(await claimDraftableClusters({ clusterIds: [id], limit: 1 })).toEqual([]);
    await db()`update idea_clusters set draft_claimed_at = now() - interval '16 minutes' where id = ${id}`;
    expect(await claimDraftableClusters({ clusterIds: [id], limit: 1 })).toEqual([{ id, attempts: 2 }]);
  });
});
