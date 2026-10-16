import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  nearestClusters: vi.fn(),
  hasMentionFromSameOccasion: vi.fn(),
}));
vi.mock("../../../agent/lib/store/ideas", () => store);

import { planIdeaClusters } from "../../../agent/lib/ideas/compost";
import type { SaveItem } from "../../../agent/lib/pipeline/save-item";
import type { ClusterOption } from "../../../agent/lib/ideas/choose-cluster";

const vec = (i: number) => Array.from({ length: 1536 }, (_, j) => (j === i ? 1 : 0));
const idea = (title: string, over: Partial<SaveItem> = {}): SaveItem => ({
  kind: "idea", route: "accept", extraction: { title, excerpt: `what if we did ${title}` },
  beeConversationId: 501, beeJournalId: null, spokenAt: new Date("2026-10-15T14:00:00Z"), confidence: 0.91, source: "ambient",
  ...over,
} as SaveItem);
const rec: SaveItem = {
  kind: "rec", route: "accept", recType: "place", extraction: { canonicalName: "Ardent", creator: null, recommenderName: null, excerpt: "try Ardent" },
  attribution: { firstName: null, source: "none" }, beeConversationId: 501, beeJournalId: null, spokenAt: new Date(), confidence: 0.9, source: "ambient",
};
const dbCluster = (id: number, title = "AI newsletter") => ({ id, title, excerpt: "an excerpt", stage: "compost", pinned: false, mentionCount: 1, distance: 0.1 });

type Choose = (idea: { title: string; excerpt: string }, options: ClusterOption[]) => Promise<{ key: string | null; choice: string; probability: number }>;
const deps = {
  embedText: vi.fn(async (_t: string) => vec(0)),
  chooseCluster: vi.fn<Choose>(),
};

beforeEach(() => {
  vi.clearAllMocks();
  deps.embedText.mockImplementation(async () => vec(0));
  store.nearestClusters.mockResolvedValue([]);
  store.hasMentionFromSameOccasion.mockResolvedValue(false);
  deps.chooseCluster.mockImplementation(async (_i, opts) => (opts.length === 0 ? { key: null, choice: "new_idea", probability: 1 } : { key: null, choice: "new_idea", probability: 0.9 }));
});

describe("planIdeaClusters", () => {
  it("passes recs and needs_review ideas through untouched, without any model call", async () => {
    const review = idea("Review me", { route: "review" });
    expect(await planIdeaClusters([rec, review], deps)).toEqual([rec, review]);
    expect(deps.embedText).not.toHaveBeenCalled();
  });

  it("embeds title plus excerpt and creates a new cluster (with its centroid) when nothing is near", async () => {
    const [out] = await planIdeaClusters([idea("House music segment")], deps);
    expect(deps.embedText).toHaveBeenCalledWith("House music segment. what if we did House music segment");
    expect(out).toMatchObject({ kind: "idea", cluster: { action: "create", embedding: vec(0) } });
  });

  it("joins the existing cluster Jev chose (nearest 5 offered as c_<id> options)", async () => {
    store.nearestClusters.mockResolvedValue([dbCluster(12), dbCluster(40, "Jazz")]);
    deps.chooseCluster.mockResolvedValue({ key: "c_12", choice: "c_12", probability: 0.8 });
    const [out] = await planIdeaClusters([idea("Newsletter on AI")], deps);
    expect(store.nearestClusters).toHaveBeenCalledWith(vec(0), 5);
    expect(deps.chooseCluster.mock.calls[0]![1].map((o) => o.key)).toEqual(["c_12", "c_40"]);
    expect(out).toMatchObject({ cluster: { action: "join", clusterId: 12, embedding: vec(0) } });
  });

  it("records nothing when the chosen cluster already has a mention from the same conversation", async () => {
    store.nearestClusters.mockResolvedValue([dbCluster(12)]);
    deps.chooseCluster.mockResolvedValue({ key: "c_12", choice: "c_12", probability: 0.8 });
    store.hasMentionFromSameOccasion.mockResolvedValue(true);
    expect(await planIdeaClusters([idea("Newsletter on AI")], deps)).toEqual([]);
    expect(store.hasMentionFromSameOccasion).toHaveBeenCalledWith(12, { beeConversationId: 501, beeJournalId: null });
  });

  it("checks the same journal for a voice note", async () => {
    store.nearestClusters.mockResolvedValue([dbCluster(12)]);
    deps.chooseCluster.mockResolvedValue({ key: "c_12", choice: "c_12", probability: 0.8 });
    store.hasMentionFromSameOccasion.mockResolvedValue(true);
    expect(await planIdeaClusters([idea("Note", { beeConversationId: null, beeJournalId: "57", source: "voice" })], deps)).toEqual([]);
    expect(store.hasMentionFromSameOccasion).toHaveBeenCalledWith(12, { beeConversationId: null, beeJournalId: "57" });
  });

  it("two windows of one conversation that both say new_idea for the same idea: the second is offered the first and recorded once", async () => {
    deps.embedText.mockImplementation(async (t: string) => (t.startsWith("Second") ? vec(1) : vec(0)));
    deps.chooseCluster
      .mockResolvedValueOnce({ key: null, choice: "new_idea", probability: 1 })
      .mockResolvedValueOnce({ key: "n_0", choice: "n_0", probability: 0.9 });
    const out = await planIdeaClusters([idea("First take"), rec, idea("Second take")], deps);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ cluster: { action: "create" } });
    expect(out[1]).toBe(rec);
    const offered = deps.chooseCluster.mock.calls[1]![1];
    expect(offered).toEqual([expect.objectContaining({ key: "n_0", title: "First take" })]);
  });

  it("decides sequentially: a later idea is offered new clusters from earlier in the run alongside the nearest stored ones", async () => {
    store.nearestClusters.mockResolvedValue([dbCluster(12)]);
    deps.chooseCluster.mockResolvedValue({ key: null, choice: "new_idea", probability: 0.9 });
    const out = await planIdeaClusters([idea("A"), idea("B")], deps);
    expect(out.map((i) => (i.kind === "idea" ? i.cluster?.action : null))).toEqual(["create", "create"]);
    expect(deps.chooseCluster.mock.calls[1]![1].map((o) => o.key).sort()).toEqual(["c_12", "n_0"]);
  });

  it("two windows of one conversation that join the same stored cluster: recorded once", async () => {
    store.nearestClusters.mockResolvedValue([dbCluster(12)]);
    deps.chooseCluster.mockResolvedValue({ key: "c_12", choice: "c_12", probability: 0.8 });
    const out = await planIdeaClusters([idea("A"), idea("B")], deps);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ cluster: { action: "join", clusterId: 12 } });
  });

  it("an embedding failure falls back to a new cluster without a centroid and logs ids + error name only", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    class GatewayError extends Error { override name = "GatewayError"; }
    deps.embedText.mockRejectedValueOnce(new GatewayError("transcript words here"));
    const [out] = await planIdeaClusters([idea("House music segment")], deps);
    expect(out).toMatchObject({ cluster: { action: "create", embedding: null } });
    const logged = spy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toContain("conversation=501");
    expect(logged).toContain("GatewayError");
    expect(logged).not.toContain("transcript words");
    spy.mockRestore();
  });

  it("a cluster-choice failure falls back to a new cluster that keeps its embedding", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    store.nearestClusters.mockResolvedValue([dbCluster(12)]);
    deps.chooseCluster.mockRejectedValueOnce(new Error("jev down"));
    const [out] = await planIdeaClusters([idea("House music segment")], deps);
    expect(out).toMatchObject({ cluster: { action: "create", embedding: vec(0) } });
    expect(spy.mock.calls.map((c) => c.join(" ")).join("\n")).not.toContain("jev down");
    spy.mockRestore();
  });
});
