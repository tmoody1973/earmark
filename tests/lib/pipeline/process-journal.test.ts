import { beforeEach, describe, expect, it, vi } from "vitest";

// Fake Neon: transaction(fn) collects the statements fn builds and "commits" them all or none.
const committed: { sql: string; params: unknown[] }[] = [];
const fail = { re: null as RegExp | null };
vi.mock("../../../agent/lib/db", () => ({
  db: () => ({
    transaction: async (fn: (t: unknown) => { sql: string; params: unknown[] }[]) => {
      const qs = fn((strings: TemplateStringsArray, ...params: unknown[]) => ({ sql: strings.join("?"), params }));
      if (qs.some((q) => fail.re?.test(q.sql))) throw new Error("db down");
      committed.push(...qs);
      return qs.map((_, i) => [{ id: i + 1, cluster_id: 101 + i }]); // one result (rows) per statement, like Neon
    },
  }),
}));
vi.mock("../../../agent/lib/store/conversations", async (orig) => ({
  ...(await orig<typeof import("../../../agent/lib/store/conversations")>()),
  markJournalProcessed: vi.fn(async () => true),
  releaseJournal: vi.fn(async () => undefined),
}));

vi.mock("../../../agent/lib/ideas/compost", async (orig) => ({
  ...(await orig<typeof import("../../../agent/lib/ideas/compost")>()),
  planIdeaClusters: vi.fn(async (items: unknown[]) => items),
}));

import { CompostUnavailableError, planIdeaClusters } from "../../../agent/lib/ideas/compost";
import { markJournalProcessed, releaseJournal } from "../../../agent/lib/store/conversations";
import { processJournal } from "../../../agent/lib/pipeline/process-journal";
import type { PipelineDeps } from "../../../agent/lib/pipeline/process-conversation";
import { SystemicTriageError } from "../../../agent/lib/pipeline/triage";
import { createBeeClient, type BeeClient } from "../../../agent/lib/bee/client";
import { parseBeeEnvelope } from "../../../agent/lib/bee/events";

const createdAt = new Date("2026-10-16T16:00:00Z");
const NONE = { recIds: [], ideaClusterIds: [], mentionIds: [], bloomedClusterIds: [] };
const triage = (kind: string, p = 0.4) =>
  vi.fn(async () => ({ kind, kindProbability: p, recType: "place", recTypeProbability: 0.7, jokingProbability: 0, broadcastProbability: 0.01, model: "m", providerMetadata: {} })) as unknown as PipelineDeps["triage"];
const extractRecommendation = vi.fn(async () => ({ canonicalName: "Ardent", creator: null, recommenderName: "Ann", excerpt: "Ann's ramen spot" })) as PipelineDeps["extractRecommendation"];
const extractIdea = vi.fn(async () => ({ title: "AI in public radio newsletter", excerpt: "newsletter idea about AI in public radio" })) as PipelineDeps["extractIdea"];
const deps = (kind: string, p?: number): Partial<PipelineDeps> => ({
  bee: {} as BeeClient, triage: triage(kind, p), extractRecommendation, extractIdea, now: () => createdAt,
});
const recs = () => committed.filter((q) => /insert into recommendations/.test(q.sql));
const ideas = () => committed.filter((q) => /insert into idea_clusters/.test(q.sql));

beforeEach(() => {
  vi.clearAllMocks();
  committed.length = 0;
  fail.re = null;
  vi.mocked(markJournalProcessed).mockReset();
  vi.mocked(markJournalProcessed).mockResolvedValue(true);
});

describe("processJournal", () => {
  it("claims a non-trigger voice note as none without calling any model", async () => {
    const d = deps("neither");
    expect(await processJournal({ id: "55", text: "remind me to call mom", createdAt }, d)).toEqual({ created: null, saved: NONE });
    expect(markJournalProcessed).toHaveBeenCalledWith("55", { type: "none", id: null }, true); // finished in one step
    expect(d.triage).not.toHaveBeenCalled();
    expect(committed).toHaveLength(0);
  });

  it("saves a voice note even when broadcastProbability is high (explicit capture, no broadcast gate)", async () => {
    const t = vi.fn(async () => ({ kind: "neither", kindProbability: 0.3, recType: "place", recTypeProbability: 0.7, jokingProbability: 0, broadcastProbability: 0.95, model: "m", providerMetadata: {} })) as unknown as PipelineDeps["triage"];
    const r = await processJournal({ id: "57", text: "Earmark that, Ann's ramen spot", createdAt }, { ...deps("neither"), triage: t });
    expect(r.created).toBe("rec");
    expect(recs()).toHaveLength(1);
  });

  it("ignores empty or whitespace text without claiming", async () => {
    expect(await processJournal({ id: "55", text: "  \n ", createdAt }, deps("neither"))).toEqual({ created: null, saved: NONE });
    expect(markJournalProcessed).not.toHaveBeenCalled();
  });

  it("captures a voice rec at full confidence even when Jev is unsure, credited to the named person", async () => {
    const d = deps("neither", 0.3);
    expect(await processJournal({ id: "56", text: "Earmark that, Ann's ramen spot", createdAt }, d)).toEqual({ created: "rec", saved: { recIds: [1], ideaClusterIds: [], mentionIds: [], bloomedClusterIds: [] } });
    expect(d.triage).toHaveBeenCalledWith("Unknown: Ann's ramen spot");
    const [rec] = recs();
    expect(rec!.params).toEqual(expect.arrayContaining(["place", "Ardent", "voice_trigger", "voice", "56", 1, createdAt]));
    expect(rec!.sql).toMatch(/recommenders/);
    // claim is finalised in the same transaction as the item
    expect(committed.some((q) => /update processed_journals/.test(q.sql))).toBe(true);
    expect(markJournalProcessed).toHaveBeenCalledTimes(1);
  });

  it("stores no recommender and attribution none when the named person is not in the note", async () => {
    const noName = vi.fn(async () => ({ canonicalName: "Ardent", creator: null, recommenderName: "Bob", excerpt: "that ramen spot" })) as PipelineDeps["extractRecommendation"];
    await processJournal({ id: "58", text: "Earmark that, the ramen spot on Brady", createdAt }, { ...deps("neither"), extractRecommendation: noName });
    const [rec] = recs();
    expect(rec!.sql).toMatch(/null, 'none'/);
    expect(rec!.sql).not.toMatch(/recommenders/);
  });

  it("captures a voice idea when Jev says idea, accepted at confidence 1", async () => {
    expect(await processJournal({ id: "57", text: "Earmark that, newsletter idea about AI in public radio", createdAt }, deps("idea_by_user", 0.9))).toEqual({ created: "idea", saved: { recIds: [], ideaClusterIds: [101], mentionIds: [1], bloomedClusterIds: [] } });
    expect(ideas()).toHaveLength(1);
    expect(committed.some((q) => /update processed_journals set item_type = 'idea'/.test(q.sql))).toBe(true);
    expect(ideas()[0]!.sql).toMatch(/insert into idea_mentions/);
    expect(ideas()[0]!.params).toEqual(expect.arrayContaining(["voice", "57", 1, "accepted"]));
  });

  it("hands its compost deps to cluster planning, so tests never reach the Gateway", async () => {
    const compost = { embedText: vi.fn(async () => [1]) };
    await processJournal({ id: "58", text: "Earmark that, newsletter idea about AI in public radio", createdAt }, { ...deps("idea_by_user", 0.9), compost });
    expect(vi.mocked(planIdeaClusters).mock.calls[0]![1]).toBe(compost);
  });

  it("routes a voice idea through cluster planning and saves a join on the chosen cluster", async () => {
    vi.mocked(planIdeaClusters).mockImplementationOnce(async (items) =>
      items.map((it) => (it.kind === "idea" ? { ...it, cluster: { action: "join" as const, clusterId: 12, embedding: [1] } } : it)));
    const r = await processJournal({ id: "57", text: "Earmark that, newsletter idea about AI in public radio", createdAt }, deps("idea_by_user", 0.9));
    expect(vi.mocked(planIdeaClusters).mock.calls[0]![0]).toEqual([expect.objectContaining({ kind: "idea", source: "voice", beeJournalId: "57" })]);
    expect(ideas()).toHaveLength(0);
    expect(committed.find((q) => /update idea_clusters/.test(q.sql))!.params).toEqual(expect.arrayContaining([12, "voice", "57"]));
    expect(r).toEqual({ created: "idea", saved: { recIds: [], ideaClusterIds: [101], mentionIds: [1], bloomedClusterIds: [] } });
  });

  it("a voice idea the planner drops (this note already counted) saves nothing new but still finishes the claim", async () => {
    vi.mocked(planIdeaClusters).mockImplementationOnce(async () => []);
    const r = await processJournal({ id: "57", text: "Earmark that, newsletter idea about AI in public radio", createdAt }, deps("idea_by_user", 0.9));
    expect(r).toEqual({ created: null, saved: NONE });
    expect(committed.filter((q) => /idea_mentions \(|idea_clusters/.test(q.sql) && !/processed_journals/.test(q.sql))).toHaveLength(0);
    expect(committed.some((q) => /update processed_journals set item_type = 'idea'/.test(q.sql))).toBe(true);
  });

  it("clamps the stored excerpt to 25 words while the voice body may be long", async () => {
    const long = Array.from({ length: 60 }, (_, i) => `w${i}`).join(" ");
    const ex = vi.fn(async () => ({ canonicalName: "X", creator: null, recommenderName: null, excerpt: long })) as PipelineDeps["extractRecommendation"];
    await processJournal({ id: "59", text: `Earmark that, ${long}`, createdAt }, { ...deps("neither"), extractRecommendation: ex });
    const stored = recs()[0]!.params.filter((p) => typeof p === "string" && p.startsWith("w0")) as string[];
    expect(stored.length).toBeGreaterThan(0);
    for (const s of stored) expect(s.split(/\s+/).length).toBeLessThanOrEqual(25);
  });

  it("does nothing when the journal was already claimed (created then updated delivery)", async () => {
    vi.mocked(markJournalProcessed).mockResolvedValueOnce(true).mockResolvedValue(false);
    const j = { id: "56", text: "Earmark that, Ann's ramen spot", createdAt };
    await processJournal(j, deps("neither"));
    expect(await processJournal(j, deps("neither"))).toEqual({ created: null, saved: NONE });
    expect(recs()).toHaveLength(1);
  });

  it("dedupes a stream journal (numeric id 55) against the REST backfill (string id \"55\") to one item", async () => {
    const seen = new Set<string>();
    vi.mocked(markJournalProcessed).mockImplementation(async (id) => (seen.has(id) ? false : (seen.add(id), true)));
    const fromStream = parseBeeEnvelope({ event: "journal-updated", ts: "t", data: { journal: { id: 55, state: "processed", text: "Earmark that, Ann's ramen spot" } } });
    if (fromStream.event !== "journal-updated") throw new Error("narrowing");
    const fromRest = (await createBeeClient({
      token: "t", baseUrl: "https://bee.test",
      fetchImpl: (async () => new Response(JSON.stringify({ journals: [{ id: "55", text: "Earmark that, Ann's ramen spot", state: "READY", created_at: 1 }], next_cursor: null }))) as unknown as typeof fetch,
    }).listJournals()).journals[0]!;
    await processJournal({ id: fromStream.data.journal.id, text: fromStream.data.journal.text!, createdAt }, deps("neither"));
    await processJournal({ id: fromRest.id, text: fromRest.text!, createdAt }, deps("neither"));
    expect(recs()).toHaveLength(1);
  });

  it("saves nothing and releases the claim when the save fails mid-way, then rethrows the original error", async () => {
    fail.re = /update processed_journals/;
    await expect(processJournal({ id: "60", text: "Earmark that, Ann's ramen spot", createdAt }, deps("neither"))).rejects.toThrow("db down");
    expect(committed).toHaveLength(0);
    expect(releaseJournal).toHaveBeenCalledWith("60");
  });

  it("a failing triage call is systemic: releases the claim, logs one line, throws SystemicTriageError", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const bad = { ...deps("neither"), triage: vi.fn(async () => { throw new Error("gateway 401 ramen"); }) as unknown as PipelineDeps["triage"] };
    const err = await processJournal({ id: "62", text: "Earmark that, Ann's ramen spot", createdAt }, bad).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SystemicTriageError);
    expect((err as SystemicTriageError).reason).toBe("all_failed");
    expect(releaseJournal).toHaveBeenCalledWith("62");
    const logged = spy.mock.calls.flat().join("\n");
    expect(logged).toContain("[pipeline] systemic failure journal=62 reason=all_failed");
    expect(logged).not.toContain("ramen");
    spy.mockRestore();
  });

  it("a triage result without a finite kind probability is systemic (no_probabilities) and saves nothing", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const err = await processJournal({ id: "63", text: "Earmark that, Ann's ramen spot", createdAt }, deps("neither", Number.NaN))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SystemicTriageError);
    expect((err as SystemicTriageError).reason).toBe("no_probabilities");
    expect(releaseJournal).toHaveBeenCalledWith("63");
    expect(committed).toHaveLength(0);
    expect(spy.mock.calls.flat().join("\n")).toContain("[pipeline] systemic failure journal=63 reason=no_probabilities");
    spy.mockRestore();
  });

  it("a compost outage on a voice idea saves nothing, releases the claim and throws CompostUnavailableError", async () => {
    vi.mocked(planIdeaClusters).mockRejectedValueOnce(new CompostUnavailableError(1));
    const err = await processJournal({ id: "57", text: "Earmark that, newsletter idea about AI in public radio", createdAt }, deps("idea_by_user", 0.9)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CompostUnavailableError);
    expect(committed).toHaveLength(0);
    expect(releaseJournal).toHaveBeenCalledWith("57");
  });

  it("rethrows the original error even when releasing the claim also fails", async () => {
    vi.mocked(releaseJournal).mockRejectedValueOnce(new Error("release boom"));
    const bad = { ...deps("neither"), extractRecommendation: vi.fn(async () => { throw new Error("model down"); }) as PipelineDeps["extractRecommendation"] };
    await expect(processJournal({ id: "61", text: "Earmark that, Ann's ramen spot", createdAt }, bad)).rejects.toThrow("model down");
  });
});
