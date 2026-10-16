import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  nearestClusters: vi.fn(),
  hasMentionFromSameOccasion: vi.fn(),
  getClusterTimeline: vi.fn(),
}));
vi.mock("../../../agent/lib/store/ideas", () => store);

import { CompostUnavailableError, planIdeaClusters } from "../../../agent/lib/ideas/compost";
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
  writeTimelineNote: vi.fn(async (_i: { clusterTitle: string; priorLines: string[]; excerpt: string }) => "added a radio segment angle"),
};

beforeEach(() => {
  vi.clearAllMocks();
  deps.embedText.mockImplementation(async () => vec(0));
  store.nearestClusters.mockResolvedValue([]);
  store.hasMentionFromSameOccasion.mockResolvedValue(false);
  store.getClusterTimeline.mockResolvedValue([]);
  deps.writeTimelineNote.mockImplementation(async () => "added a radio segment angle");
  deps.chooseCluster.mockImplementation(async (_i, opts) => (opts.length === 0 ? { key: null, choice: "new_idea", probability: 1 } : { key: null, choice: "new_idea", probability: 0.9 }));
});

describe("planIdeaClusters", () => {
  it("passes recs through untouched, without any model call (and never throws when no idea needed a plan)", async () => {
    expect(await planIdeaClusters([rec], deps)).toEqual([rec]);
    expect(deps.embedText).not.toHaveBeenCalled();
  });

  it("plans a needs_review idea exactly like an accepted one (Tarik: review-band ideas count)", async () => {
    store.nearestClusters.mockResolvedValue([dbCluster(12)]);
    deps.chooseCluster.mockResolvedValue({ key: "c_12", choice: "c_12", probability: 0.8 });
    const [out] = await planIdeaClusters([idea("Review me", { route: "review" })], deps);
    expect(out).toMatchObject({ route: "review", cluster: { action: "join", clusterId: 12, embedding: vec(0) } });
  });

  it("a needs_review idea with nothing near creates its own cluster with a centroid", async () => {
    const [out] = await planIdeaClusters([idea("Review me", { route: "review" })], deps);
    expect(out).toMatchObject({ route: "review", cluster: { action: "create", embedding: vec(0) } });
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

  it("a live mention checks its occasion by the stream uuid too (live + completed pass = one occasion)", async () => {
    store.nearestClusters.mockResolvedValue([dbCluster(12)]);
    deps.chooseCluster.mockResolvedValue({ key: "c_12", choice: "c_12", probability: 0.8 });
    store.hasMentionFromSameOccasion.mockResolvedValue(true);
    expect(await planIdeaClusters([idea("Live", { beeConversationId: null, beeConversationUuid: "uuid-1" })], deps)).toEqual([]);
    expect(store.hasMentionFromSameOccasion).toHaveBeenCalledWith(12, { beeConversationId: null, beeJournalId: null, beeConversationUuid: "uuid-1" });
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

  it("an embedding failure (one of two ideas) falls back to a new cluster without a centroid and logs ids + error name only", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    class GatewayError extends Error { override name = "GatewayError"; }
    deps.embedText.mockRejectedValueOnce(new GatewayError("transcript words here"));
    const [out, ok] = await planIdeaClusters([idea("House music segment"), idea("Other")], deps);
    expect(out).toMatchObject({ cluster: { action: "create", embedding: null } });
    expect(ok).toMatchObject({ cluster: { action: "create", embedding: vec(0) } });
    const logged = spy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toContain("conversation=501");
    expect(logged).toContain("stage=embed");
    expect(logged).toContain("GatewayError");
    expect(logged).not.toContain("transcript words");
    spy.mockRestore();
  });

  it("a cluster-choice failure (one of two ideas) falls back to a new cluster that keeps its embedding", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    store.nearestClusters.mockResolvedValue([dbCluster(12)]);
    deps.chooseCluster.mockRejectedValueOnce(new Error("jev down"));
    const [out] = await planIdeaClusters([idea("House music segment"), idea("Other")], deps);
    expect(out).toMatchObject({ cluster: { action: "create", embedding: vec(0) } });
    const logged = spy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toContain("stage=choose");
    expect(logged).not.toContain("jev down");
    spy.mockRestore();
  });

  it("an occasion-check failure (one of two ideas) falls back to a new cluster that keeps its embedding", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    store.nearestClusters.mockResolvedValue([dbCluster(12)]);
    deps.chooseCluster.mockResolvedValue({ key: "c_12", choice: "c_12", probability: 0.8 });
    store.hasMentionFromSameOccasion.mockRejectedValueOnce(new Error("db blip"));
    const out = await planIdeaClusters([idea("A"), idea("B")], deps);
    expect(out[0]).toMatchObject({ cluster: { action: "create", embedding: vec(0) } });
    expect(out[1]).toMatchObject({ cluster: { action: "join", clusterId: 12 } });
    expect(spy.mock.calls.map((c) => c.join(" ")).join("\n")).toContain("stage=occasion");
    spy.mockRestore();
  });

  it("a fallback create without an embedding is not offered to later ideas", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    deps.embedText.mockRejectedValueOnce(new Error("x"));
    await planIdeaClusters([idea("A"), idea("B")], deps);
    expect(deps.chooseCluster).toHaveBeenCalledTimes(1); // only B's decision
    expect(deps.chooseCluster.mock.calls[0]![1]).toEqual([]);
    spy.mockRestore();
  });

  it("every idea failing (n = 1) is a compost outage: throws CompostUnavailableError so the claim is released and retried", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    deps.embedText.mockRejectedValueOnce(new Error("gateway down"));
    const err = await planIdeaClusters([rec, idea("A")], deps).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CompostUnavailableError);
    expect((err as Error).name).toBe("CompostUnavailableError");
    spy.mockRestore();
  });

  it("every idea failing (n = 2, mixed embed and choose stages) throws CompostUnavailableError", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    store.nearestClusters.mockResolvedValue([dbCluster(12)]);
    deps.embedText.mockRejectedValueOnce(new Error("embed down"));
    deps.chooseCluster.mockRejectedValueOnce(new Error("jev down"));
    await expect(planIdeaClusters([idea("A"), idea("B", { route: "review" })], deps)).rejects.toBeInstanceOf(CompostUnavailableError);
    spy.mockRestore();
  });

  describe("timeline note", () => {
    const entry = (line: string) => ({ date: "2026-09-01T00:00:00.000Z", line });

    it("create: asks for a note with the idea's own title and no prior lines, and carries it on the plan", async () => {
      const [out] = await planIdeaClusters([idea("House music segment")], deps);
      expect(deps.writeTimelineNote).toHaveBeenCalledWith({ clusterTitle: "House music segment", priorLines: [], excerpt: "what if we did House music segment" });
      expect(out).toMatchObject({ cluster: { action: "create", timelineNote: "added a radio segment angle" } });
    });

    it("join: gives the model the cluster's title and only its last 2 prior lines", async () => {
      store.nearestClusters.mockResolvedValue([dbCluster(12, "AI newsletter")]);
      deps.chooseCluster.mockResolvedValue({ key: "c_12", choice: "c_12", probability: 0.8 });
      store.getClusterTimeline.mockResolvedValue([entry("Sep 1: a"), entry("Sep 2: b"), entry("Sep 3: c")]);
      const [out] = await planIdeaClusters([idea("Newsletter on AI")], deps);
      expect(store.getClusterTimeline).toHaveBeenCalledWith(12);
      expect(deps.writeTimelineNote).toHaveBeenCalledWith(expect.objectContaining({ clusterTitle: "AI newsletter", priorLines: ["Sep 2: b", "Sep 3: c"] }));
      expect(out).toMatchObject({ cluster: { action: "join", clusterId: 12, timelineNote: "added a radio segment angle" } });
    });

    it("a dropped duplicate (same occasion) generates no note at all", async () => {
      store.nearestClusters.mockResolvedValue([dbCluster(12)]);
      deps.chooseCluster.mockResolvedValue({ key: "c_12", choice: "c_12", probability: 0.8 });
      store.hasMentionFromSameOccasion.mockResolvedValue(true);
      expect(await planIdeaClusters([idea("Newsletter on AI")], deps)).toEqual([]);
      expect(deps.writeTimelineNote).not.toHaveBeenCalled();
    });

    it("note failure falls back to the code line, logs ids + error name only, and is not an outage", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      class GatewayError extends Error { override name = "GatewayError"; }
      deps.writeTimelineNote.mockRejectedValue(new GatewayError("excerpt words here"));
      store.nearestClusters.mockResolvedValue([dbCluster(12)]);
      deps.chooseCluster.mockResolvedValueOnce({ key: "c_12", choice: "c_12", probability: 0.8 }).mockResolvedValueOnce({ key: null, choice: "new_idea", probability: 1 });
      const out = await planIdeaClusters([idea("A"), idea("B")], deps);
      expect(out[0]).toMatchObject({ cluster: { action: "join", clusterId: 12, timelineNote: "mentioned again" } });
      expect(out[1]).toMatchObject({ cluster: { action: "create", timelineNote: "first heard" } });
      const logged = spy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(logged).toContain("conversation=501");
      expect(logged).toContain("GatewayError");
      expect(logged).not.toContain("excerpt words");
      spy.mockRestore();
    });

    it("an unreadable prior timeline also falls back instead of failing the plan", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      store.nearestClusters.mockResolvedValue([dbCluster(12)]);
      deps.chooseCluster.mockResolvedValue({ key: "c_12", choice: "c_12", probability: 0.8 });
      store.getClusterTimeline.mockRejectedValue(new Error("db blip"));
      const [out] = await planIdeaClusters([idea("A")], deps);
      expect(out).toMatchObject({ cluster: { action: "join", timelineNote: "mentioned again" } });
      spy.mockRestore();
    });

    it("a plan that already fell back to create (embed failed) skips the model and uses the code line", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      deps.embedText.mockRejectedValueOnce(new Error("x"));
      const [out] = await planIdeaClusters([idea("A"), idea("B")], deps);
      expect(out).toMatchObject({ cluster: { action: "create", timelineNote: "first heard" } });
      spy.mockRestore();
    });
  });
});
