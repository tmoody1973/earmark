import { APICallError, RetryError } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Fake Neon: transaction(fn) collects the statements fn builds and "commits" them all or none.
// A statement matching failOn (1-based nth occurrence) makes the whole transaction throw with nothing committed.
const committed: { sql: string; params: unknown[] }[] = [];
const fail = { re: null as RegExp | null, nth: 0 };
vi.mock("../../../agent/lib/db", () => ({
  db: () => ({
    transaction: async (fn: (t: unknown) => { sql: string; params: unknown[] }[]) => {
      const qs = fn((strings: TemplateStringsArray, ...params: unknown[]) => ({ sql: strings.join("?"), params }));
      let seen = 0;
      for (const q of qs) {
        if (fail.re?.test(q.sql) && ++seen === fail.nth) throw new Error("db down");
      }
      committed.push(...qs);
      return qs.map((_, i) => [{ id: i + 1, cluster_id: 101 + i }]); // one result (rows) per statement, like Neon
    },
  }),
}));
vi.mock("../../../agent/lib/store/conversations", async (orig) => ({
  ...(await orig<typeof import("../../../agent/lib/store/conversations")>()),
  isConversationProcessed: vi.fn(async () => false),
  markConversationProcessed: vi.fn(async () => true),
  releaseConversation: vi.fn(async () => undefined),
  savedDeliberateKeys: vi.fn(async () => new Map<string, string | null>()),
  recsSaidBetween: vi.fn(async () => []),
}));

// Cluster planning (embedding + Jev) is unit-tested in tests/lib/ideas/compost.test.ts; here it passes items through.
vi.mock("../../../agent/lib/ideas/compost", async (orig) => ({
  ...(await orig<typeof import("../../../agent/lib/ideas/compost")>()),
  planIdeaClusters: vi.fn(async (items: unknown[]) => items),
}));

import { CompostUnavailableError, planIdeaClusters } from "../../../agent/lib/ideas/compost";
import { isConversationProcessed, markConversationProcessed, recsSaidBetween, releaseConversation, savedDeliberateKeys } from "../../../agent/lib/store/conversations";
import { processConversation, type PipelineDeps } from "../../../agent/lib/pipeline/process-conversation";
import { SystemicTriageError } from "../../../agent/lib/pipeline/triage";
import type { BeeClient } from "../../../agent/lib/bee/client";
import type { TriageResult } from "../../../agent/lib/types";

const recs = () => committed.filter((q) => /insert into recommendations/.test(q.sql));
const ideas = () => committed.filter((q) => /insert into idea_clusters/.test(q.sql));

const lines = (n: number, text = "you have to try Ardent, Ann says") =>
  Array.from({ length: n }, (_, i) => ({ text: `${text} ${i}`, speaker: "Unknown", spoken_at: 1760600000000 + i }));

function bee(state = "COMPLETED", utterances = lines(4), summary: string | null = null, primary_location: unknown = null): BeeClient {
  return {
    getConversation: vi.fn(async () => ({
      conversation: { id: 42, start_time: 1760600000000, state, summary, primary_location, transcriptions: [{ realtime: false, utterances }] },
    })),
  } as unknown as BeeClient;
}

const tri = (over: Partial<TriageResult>): PipelineDeps["triage"] =>
  vi.fn(async () => ({ kind: "rec_to_user", kindProbability: 0.95, recType: "place", recTypeProbability: 0.9, jokingProbability: 0.02, broadcastProbability: 0.01, model: "m", providerMetadata: {}, ...over })) as PipelineDeps["triage"];

const extractRec = (recommenderName: string | null = "Ann", excerpt = "you have to try Ardent") =>
  vi.fn(async () => ({ canonicalName: "Ardent", creator: null, recommenderName, excerpt })) as PipelineDeps["extractRecommendation"];
const extractIdea = vi.fn(async () => ({ title: "House music segment", excerpt: "what if we did" })) as PipelineDeps["extractIdea"];
const now = () => new Date("2026-10-16T12:00:00Z");
const base = { extractRecommendation: extractRec(), extractIdea, now };

beforeEach(() => {
  vi.clearAllMocks();
  committed.length = 0;
  fail.re = null;
  fail.nth = 0;
});

describe("processConversation", () => {
  it("skips a conversation that is already processed without calling Bee", async () => {
    vi.mocked(isConversationProcessed).mockResolvedValueOnce(true);
    const b = bee();
    expect(await processConversation(42, { ...base, bee: b, triage: tri({}) })).toMatchObject({ skipped: true });
    expect(b.getConversation).not.toHaveBeenCalled();
  });

  it("skips a conversation that is still capturing without claiming it", async () => {
    const r = await processConversation(42, { ...base, bee: bee("CAPTURING"), triage: tri({}) });
    expect(r.skipped).toBe(true);
    expect(r.reason).toBe("capturing");
    expect(markConversationProcessed).not.toHaveBeenCalled();
  });

  it("stores an accepted rec with a second-person attribution, and the counts, in one transaction", async () => {
    const r = await processConversation(42, { ...base, bee: bee(), triage: tri({}) });
    // saved ids come from the transaction's own results (statement 1 = the rec insert)
    expect(r).toEqual({ skipped: false, ideas: 0, recs: 1, reviews: 0, failed: 0, incomplete: false, saved: { recIds: [1], ideaClusterIds: [], mentionIds: [], bloomedClusterIds: [] } });
    expect(recs()).toHaveLength(1);
    const q = recs()[0]!;
    expect(q.sql).toContain("insert into recommenders");
    expect(q.params).toEqual(expect.arrayContaining(["Ann", "place", "Ardent", "second_person", "new", "ambient", 42, 0.95]));
    expect(committed.some((c) => /update processed_conversations/.test(c.sql) && c.params.includes(1))).toBe(true);
  });

  it("stores where the conversation happened on the rec as said_lat/said_lng", async () => {
    const loc = { address: null, latitude: 43.0389, longitude: -87.9065 };
    await processConversation(42, { ...base, bee: bee("COMPLETED", lines(4), null, loc), triage: tri({}) });
    expect(recs()[0]!.sql).toContain("said_lat");
    expect(recs()[0]!.params).toEqual(expect.arrayContaining([43.0389, -87.9065]));
  });

  it("leaves said_lat/said_lng null when Bee has no location", async () => {
    await processConversation(42, { ...base, bee: bee(), triage: tri({}) });
    expect(recs()[0]!.params).not.toContain(undefined);
    expect(recs()[0]!.params.filter((p) => typeof p === "number" && p > 40 && p < 44 && !Number.isInteger(p))).toEqual([]);
  });

  it("stores a mid-confidence rec as needs_review", async () => {
    const r = await processConversation(42, { ...base, bee: bee(), triage: tri({ kindProbability: 0.7 }) });
    expect(r.reviews).toBe(1);
    expect(recs()[0]!.params).toContain("needs_review");
  });

  it.each([
    ["neither", { kind: "neither" as const }],
    ["the user's own recommendation", { kind: "rec_by_user" as const }],
    ["a joke", { jokingProbability: 0.8 }],
    ["a joke that is also the user's own recommendation", { kind: "rec_by_user" as const, jokingProbability: 0.8 }],
    ["low confidence", { kindProbability: 0.3 }],
  ])("drops %s but still keeps the conversation claimed", async (_label, over) => {
    const r = await processConversation(42, { ...base, bee: bee(), triage: tri(over) });
    expect(r).toEqual({ skipped: false, ideas: 0, recs: 0, reviews: 0, failed: 0, incomplete: false, saved: { recIds: [], ideaClusterIds: [], mentionIds: [], bloomedClusterIds: [] } });
    expect(recs()).toHaveLength(0);
    expect(releaseConversation).not.toHaveBeenCalled();
  });

  it("drops a broadcast/ad window before extraction ever runs", async () => {
    const ex = extractRec();
    const r = await processConversation(42, { ...base, extractRecommendation: ex, bee: bee(), triage: tri({ broadcastProbability: 0.9 }) });
    expect(ex).not.toHaveBeenCalled();
    expect(recs()).toHaveLength(0);
    expect(r).toMatchObject({ skipped: false, recs: 0, failed: 0 });
    expect(releaseConversation).not.toHaveBeenCalled();
  });

  it("keeps a window with low broadcast probability, and treats exactly BROADCAST_MAX as not broadcast", async () => {
    await processConversation(42, { ...base, bee: bee(), triage: tri({ broadcastProbability: 0.5 }) });
    expect(recs()).toHaveLength(1);
  });

  it("applies the broadcast gate even when the window would also be a joke (gate order: after neither, before joke)", async () => {
    const ex = extractRec();
    await processConversation(42, { ...base, extractRecommendation: ex, bee: bee(), triage: tri({ jokingProbability: 0.9, broadcastProbability: 0.9 }) });
    expect(ex).not.toHaveBeenCalled();
    expect(recs()).toHaveLength(0);
  });

  it("fails closed: a NaN broadcast answer on one window drops only that window", async () => {
    const triage = vi.fn()
      .mockResolvedValueOnce({ kind: "rec_to_user", kindProbability: 0.95, recType: "place", recTypeProbability: 0.9, jokingProbability: 0, broadcastProbability: Number.NaN, model: "m", providerMetadata: {} })
      .mockResolvedValue({ kind: "rec_to_user", kindProbability: 0.95, recType: "place", recTypeProbability: 0.9, jokingProbability: 0, broadcastProbability: 0.02, model: "m", providerMetadata: {} }) as PipelineDeps["triage"];
    const ex = extractRec();
    const r = await processConversation(42, { ...base, extractRecommendation: ex, bee: bee("COMPLETED", lines(6)), triage });
    expect(r).toMatchObject({ skipped: false, failed: 0 });
    expect(vi.mocked(ex).mock.calls.length).toBe(vi.mocked(triage).mock.calls.length - 1); // only the NaN window is dropped
  });

  it("treats a missing broadcast answer on every window as systemic and releases the claim", async () => {
    const err = await processConversation(42, { ...base, bee: bee("COMPLETED", lines(6)), triage: tri({ broadcastProbability: Number.NaN }) }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SystemicTriageError);
    expect((err as SystemicTriageError).reason).toBe("no_probabilities");
    expect(releaseConversation).toHaveBeenCalledWith(42);
  });

  it.each(["88.9", "88.9 FM", "102.1"])("rejects a rec whose name is only the frequency %s", async (name) => {
    const ex = vi.fn(async () => ({ canonicalName: name, creator: null, recommenderName: null, excerpt: "x" })) as PipelineDeps["extractRecommendation"];
    await processConversation(42, { ...base, extractRecommendation: ex, bee: bee(), triage: tri({}) });
    expect(recs()).toHaveLength(0);
  });

  it.each(["Kopp's", "Sault"])("keeps a rec named %s", async (name) => {
    const ex = vi.fn(async () => ({ canonicalName: name, creator: null, recommenderName: null, excerpt: "x" })) as PipelineDeps["extractRecommendation"];
    await processConversation(42, { ...base, extractRecommendation: ex, bee: bee(), triage: tri({}) });
    expect(recs()).toHaveLength(1);
  });

  it("drops a joke before extraction ever runs", async () => {
    const ex = extractRec();
    await processConversation(42, { ...base, extractRecommendation: ex, bee: bee(), triage: tri({ kind: "rec_by_user", jokingProbability: 0.9 }) });
    expect(ex).not.toHaveBeenCalled();
  });

  it("stores a rec with no identifiable recommender as attribution none", async () => {
    await processConversation(42, { ...base, extractRecommendation: extractRec(null), bee: bee(), triage: tri({}) });
    const q = recs()[0]!;
    expect(q.sql).not.toContain("insert into recommenders");
    expect(q.sql).toMatch(/null, 'none'/); // recommender_id null, attribution 'none'
  });

  it("clamps a long model excerpt to 25 words before storing", async () => {
    const long = Array.from({ length: 40 }, (_, i) => `w${i}`).join(" ");
    await processConversation(42, { ...base, extractRecommendation: extractRec("Ann", long), bee: bee(), triage: tri({}) });
    const words = recs()[0]!.params.filter((p): p is string => typeof p === "string" && p.startsWith("w0 "));
    expect(words.length).toBeGreaterThan(0);
    for (const w of words) expect(w.split(" ")).toHaveLength(25);
  });

  it("inserts nothing when another run claimed the conversation first", async () => {
    vi.mocked(markConversationProcessed).mockResolvedValueOnce(false);
    const r = await processConversation(42, { ...base, bee: bee(), triage: tri({}) });
    expect(r.skipped).toBe(true);
    expect(committed).toHaveLength(0);
  });

  it("stores the same rec once even when overlapping windows both find it", async () => {
    const r = await processConversation(42, { ...base, bee: bee("COMPLETED", lines(6)), triage: tri({}) });
    expect(r.recs).toBe(1);
    expect(recs()).toHaveLength(1);
  });

  it("of two windows finding the same rec, keeps the more confident one", async () => {
    const triage = vi.fn()
      .mockResolvedValueOnce({ kind: "rec_to_user", kindProbability: 0.7, recType: "place", recTypeProbability: 0.9, jokingProbability: 0, broadcastProbability: 0.02, model: "m", providerMetadata: {} })
      .mockResolvedValue({ kind: "rec_to_user", kindProbability: 0.95, recType: "place", recTypeProbability: 0.9, jokingProbability: 0, broadcastProbability: 0.02, model: "m", providerMetadata: {} }) as PipelineDeps["triage"];
    const r = await processConversation(42, { ...base, bee: bee("COMPLETED", lines(6)), triage });
    expect(r).toMatchObject({ recs: 1, reviews: 0 });
    expect(recs()).toHaveLength(1);
    expect(recs()[0]!.params).toEqual(expect.arrayContaining([0.95, "new"]));
  });

  it("a skipped conversation reports no saved ids", async () => {
    vi.mocked(isConversationProcessed).mockResolvedValueOnce(true);
    expect((await processConversation(42, { ...base, bee: bee(), triage: tri({}) })).saved).toEqual({ recIds: [], ideaClusterIds: [], mentionIds: [], bloomedClusterIds: [] });
  });

  it("creates an idea cluster for an accepted idea", async () => {
    const r = await processConversation(42, { ...base, bee: bee(), triage: tri({ kind: "idea_by_user" }) });
    expect(r.ideas).toBe(1);
    expect(r.saved).toEqual({ recIds: [], ideaClusterIds: [101], mentionIds: [1], bloomedClusterIds: [] });
    expect(ideas()).toHaveLength(1);
    expect(ideas()[0]!.params).toEqual(expect.arrayContaining(["House music segment", "accepted", "ambient", 42]));
  });

  it("hands cluster planning the conversation's start/end span (to match an unmapped live mention of it)", async () => {
    const b = bee("COMPLETED");
    vi.mocked(b.getConversation).mockResolvedValueOnce({
      conversation: { id: 42, start_time: 1760600000000, end_time: 1760603600000, state: "COMPLETED", summary: null, transcriptions: [{ realtime: false, utterances: lines(4) }] },
    } as never);
    await processConversation(42, { ...base, bee: b, triage: tri({ kind: "idea_by_user" }) });
    expect(vi.mocked(planIdeaClusters).mock.calls[0]![2]).toEqual({ span: { start: new Date(1760600000000), end: new Date(1760603600000) } });
  });

  it("hands its compost deps to cluster planning, so tests never reach the Gateway", async () => {
    const compost = { embedText: vi.fn(async () => [1]) };
    await processConversation(42, { ...base, bee: bee(), triage: tri({ kind: "idea_by_user" }), compost });
    expect(vi.mocked(planIdeaClusters).mock.calls[0]![1]).toBe(compost);
  });

  it("plans clusters for the items after all windows, then saves a join as a mention on the chosen cluster", async () => {
    vi.mocked(planIdeaClusters).mockImplementationOnce(async (items) =>
      items.map((it) => (it.kind === "idea" ? { ...it, cluster: { action: "join" as const, clusterId: 12, embedding: [1, 0] } } : it)));
    const r = await processConversation(42, { ...base, bee: bee(), triage: tri({ kind: "idea_by_user" }) });
    expect(planIdeaClusters).toHaveBeenCalledTimes(1);
    expect(vi.mocked(planIdeaClusters).mock.calls[0]![0]).toEqual([expect.objectContaining({ kind: "idea", route: "accept" })]);
    expect(ideas()).toHaveLength(0); // no new cluster
    const join = committed.find((q) => /update idea_clusters/.test(q.sql))!;
    expect(join.params).toEqual(expect.arrayContaining([12, "[1,0]", "accepted", "ambient", 42]));
    expect(r).toMatchObject({ ideas: 1, saved: { ideaClusterIds: [101], mentionIds: [1], bloomedClusterIds: [] } });
  });

  it("an idea the planner drops (same conversation already counted) is neither saved nor counted", async () => {
    vi.mocked(planIdeaClusters).mockImplementationOnce(async (items) => items.filter((it) => it.kind !== "idea"));
    const r = await processConversation(42, { ...base, bee: bee(), triage: tri({ kind: "idea_by_user" }) });
    expect(r).toMatchObject({ ideas: 0, recs: 0, saved: { ideaClusterIds: [], mentionIds: [], bloomedClusterIds: [] } });
    expect(committed.filter((q) => /idea_clusters|idea_mentions/.test(q.sql))).toHaveLength(0);
    const counts = committed.find((q) => /update processed_conversations/.test(q.sql))!;
    expect(counts.params).toEqual(expect.arrayContaining([0, 0, 42]));
  });

  it("counts a failed window, logs only the error name, and keeps the claim", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    class NoObjectGeneratedError extends Error {
      override name = "NoObjectGeneratedError";
    }
    const triage = vi.fn()
      .mockRejectedValueOnce(new NoObjectGeneratedError("secret transcript words Ardent"))
      .mockResolvedValue({ kind: "rec_to_user", kindProbability: 0.95, recType: "place", recTypeProbability: 0.9, jokingProbability: 0.02, broadcastProbability: 0.02, model: "m", providerMetadata: {} }) as PipelineDeps["triage"];
    const r = await processConversation(42, { ...base, bee: bee("COMPLETED", lines(6)), triage });
    expect(r).toMatchObject({ skipped: false, recs: 1, failed: 1 });
    expect(releaseConversation).not.toHaveBeenCalled();
    const logged = spy.mock.calls.flat().join(" ");
    expect(logged).toContain("window failed");
    expect(logged).toContain("NoObjectGeneratedError");
    expect(logged).not.toContain("Ardent");
    spy.mockRestore();
  });

  it("treats every window failing as a systemic failure: releases the claim, logs one line, throws SystemicTriageError", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const triage = vi.fn(async () => { throw new Error("gateway 401 Ardent"); }) as PipelineDeps["triage"];
    const err = await processConversation(42, { ...base, bee: bee("COMPLETED", lines(6)), triage }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SystemicTriageError);
    expect((err as SystemicTriageError).reason).toBe("all_failed");
    expect(releaseConversation).toHaveBeenCalledWith(42);
    expect(committed).toHaveLength(0);
    const logged = spy.mock.calls.flat().join("\n");
    expect(logged).toContain("[pipeline] systemic failure conversation=42 reason=all_failed");
    expect(logged).not.toContain("Ardent");
    spy.mockRestore();
  });

  it("treats triage with no finite kind probability anywhere as systemic (reason no_probabilities)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const err = await processConversation(42, { ...base, bee: bee("COMPLETED", lines(6)), triage: tri({ kindProbability: Number.NaN }) })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SystemicTriageError);
    expect((err as SystemicTriageError).reason).toBe("no_probabilities");
    expect(releaseConversation).toHaveBeenCalledWith(42);
    expect(spy.mock.calls.flat().join("\n")).toContain("[pipeline] systemic failure conversation=42 reason=no_probabilities");
    spy.mockRestore();
  });

  it("is not systemic when at least one window carried a finite probability", async () => {
    const triage = vi.fn()
      .mockResolvedValueOnce({ kind: "neither", kindProbability: Number.NaN, recType: "none", recTypeProbability: Number.NaN, jokingProbability: 0, broadcastProbability: 0.02, model: "m", providerMetadata: {} })
      .mockResolvedValue({ kind: "neither", kindProbability: 0.9, recType: "none", recTypeProbability: 0.9, jokingProbability: 0, broadcastProbability: 0.02, model: "m", providerMetadata: {} }) as PipelineDeps["triage"];
    const r = await processConversation(42, { ...base, bee: bee("COMPLETED", lines(6)), triage });
    expect(r).toMatchObject({ skipped: false, failed: 0 });
    expect(releaseConversation).not.toHaveBeenCalled();
  });

  it("triages at most 4 windows at once and keeps window order for saving", async () => {
    let inFlight = 0;
    let peak = 0;
    const triage = vi.fn(async (text: string) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      const n = Number(/ (\d+)\n/.exec(text)?.[1] ?? 0); // first utterance index of the window
      await new Promise((r) => setTimeout(r, 20 - n)); // later windows finish first
      inFlight--;
      return { kind: "rec_to_user", kindProbability: 0.95, recType: "place", recTypeProbability: 0.9, jokingProbability: 0, broadcastProbability: 0.02, model: "m", providerMetadata: {} };
    }) as unknown as PipelineDeps["triage"];
    let k = 0;
    const named = vi.fn(async () => ({ canonicalName: `Spot ${k++}`, creator: null, recommenderName: null, excerpt: "you have to try it" })) as PipelineDeps["extractRecommendation"];
    const r = await processConversation(42, { ...base, extractRecommendation: named, bee: bee("COMPLETED", lines(22)), triage });
    expect(triage).toHaveBeenCalledTimes(10);
    expect(peak).toBe(4);
    expect(r.recs).toBe(10);
    // spokenAt follows window order, so saved statements must be in window order too
    const saidAt = recs().map((q) => (q.params.find((p) => p instanceof Date) as Date).getTime());
    expect(saidAt).toEqual([...saidAt].sort((a, b) => a - b));
  });

  it("saves nothing and releases the claim when the 2nd item's insert fails (all-or-nothing)", async () => {
    let n = 0;
    const names = ["Ardent", "Borderlands"];
    const twoRecs = vi.fn(async () => ({ canonicalName: names[n++ % 2]!, creator: null, recommenderName: "Ann", excerpt: "you have to try it" })) as PipelineDeps["extractRecommendation"];
    fail.re = /insert into recommendations/;
    fail.nth = 2;
    await expect(
      processConversation(42, { ...base, extractRecommendation: twoRecs, bee: bee("COMPLETED", lines(6)), triage: tri({}) }),
    ).rejects.toThrow("db down");
    expect(committed).toHaveLength(0);
    expect(releaseConversation).toHaveBeenCalledWith(42);
  });

  it("a compost outage (every idea's plan failed) saves nothing, releases the claim and throws CompostUnavailableError", async () => {
    vi.mocked(planIdeaClusters).mockRejectedValueOnce(new CompostUnavailableError(1));
    const err = await processConversation(42, { ...base, bee: bee(), triage: tri({ kind: "idea_by_user" }) }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CompostUnavailableError);
    expect(committed).toHaveLength(0);
    expect(releaseConversation).toHaveBeenCalledWith(42);
  });

  it("rethrows the ORIGINAL error even when releasing the claim also fails", async () => {
    fail.re = /insert into recommendations/;
    fail.nth = 1;
    vi.mocked(releaseConversation).mockRejectedValueOnce(new Error("release failed"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(processConversation(42, { ...base, bee: bee(), triage: tri({}) })).rejects.toThrow("db down");
    spy.mockRestore();
  });

  describe("per-conversation deadline", () => {
    it("past the deadline: no windows triaged, nothing saved, claim released, incomplete, no throw", async () => {
      const triage = tri({});
      const r = await processConversation(42, { ...base, bee: bee("COMPLETED", lines(40)), triage, deadline: now().getTime() - 1 });
      expect(r).toMatchObject({ skipped: false, incomplete: true, ideas: 0, recs: 0 });
      expect(triage).not.toHaveBeenCalled();
      expect(committed).toHaveLength(0);
      expect(releaseConversation).toHaveBeenCalledWith(42);
    });

    it("a slow triage that crosses the deadline stops scheduling new windows and saves nothing", async () => {
      let clock = now().getTime();
      const triage = vi.fn(async () => {
        clock += 1000; // each window takes 1 s
        return { kind: "rec_to_user", kindProbability: 0.95, recType: "place", recTypeProbability: 0.9, jokingProbability: 0.02, broadcastProbability: 0.01, model: "m", providerMetadata: {} };
      }) as unknown as PipelineDeps["triage"];
      const r = await processConversation(42, { ...base, bee: bee("COMPLETED", lines(60)), triage, now: () => new Date(clock), deadline: now().getTime() + 2500 });
      expect(r).toMatchObject({ skipped: false, incomplete: true });
      expect(vi.mocked(triage).mock.calls.length).toBeLessThan(10); // only windows started before the deadline (30 exist)
      expect(committed).toHaveLength(0);
      expect(releaseConversation).toHaveBeenCalledWith(42);
    });

    it("a deadline in the future leaves the normal path unchanged", async () => {
      const r = await processConversation(42, { ...base, bee: bee(), triage: tri({}), deadline: now().getTime() + 60_000 });
      expect(r).toMatchObject({ skipped: false, incomplete: false, recs: 1 });
      expect(releaseConversation).not.toHaveBeenCalled();
    });

    it("no deadline is never incomplete", async () => {
      expect(await processConversation(42, { ...base, bee: bee(), triage: tri({}) })).toMatchObject({ incomplete: false });
    });
  });

  describe("deliberate 'Earmark that' (M2-T12)", () => {
    const spoken = (text: string, id: number) => ({ text, speaker: "Unknown", spoken_at: 1760600000000 + id, id });
    const EARMARK = "Earmark that Ann says to try Ardent on Brady Street.";

    it("an ambient window that re-mentions an earmarked thing by name does not save it a second time", async () => {
      const utterances = [spoken(EARMARK, 1), spoken("so about that place", 2), spoken("it is great", 3), spoken("really great", 4)];
      const r = await processConversation(42, { ...base, bee: bee("COMPLETED", utterances), triage: tri({}) });
      expect(r).toMatchObject({ recs: 1 });
      expect(recs()).toHaveLength(1);
      expect(recs()[0]!.params).toEqual(expect.arrayContaining(["voice", "new", "u1"]));
    });

    // M2-T14: Bee heard the same words as a voice note during this conversation.
    const voiceNote = (over: Partial<{ id: number; name: string; type: string; firstName: string | null; saidAt: Date }> = {}) =>
      ({ id: 156, name: "Ardent", type: "place", firstName: "Ann", saidAt: new Date(1760600000000 + 4_000), deliberate: true, ...over });

    it("I-2a: an ambient rec is matched to a voice note by name only, never by recommender + type", async () => {
      vi.mocked(recsSaidBetween).mockResolvedValueOnce([voiceNote({ name: "Kawa Ramen", saidAt: new Date(1760600000000 + 1) })]);
      const r = await processConversation(42, { ...base, bee: bee(), triage: tri({}) }); // ambient "Ardent", Ann, place
      expect(r).toMatchObject({ recs: 1 });
    });

    it("I-2c: Marcus's Acts of Faith (saved as a voice note), then a cut-off 'Blonde' (Marcus, album): Blonde is saved", async () => {
      vi.mocked(recsSaidBetween).mockResolvedValueOnce([voiceNote({ id: 157, name: "Acts of Faith", type: "album", firstName: "Marcus" })]);
      const extractRecommendation = vi.fn(async ({ text }: { text: string }) => ({
        canonicalName: text.includes("Blonde") ? "Blonde" : "Acts of Faith", creator: null, recommenderName: "Marcus", excerpt: "Marcus says",
      })) as PipelineDeps["extractRecommendation"];
      const utterances = [spoken("Earmark that Marcus says listen to Acts of Faith.", 1), spoken("Earmark that Marcus says try Blonde now.", 2)];
      const r = await processConversation(42, { ...base, extractRecommendation, bee: bee("COMPLETED", utterances), triage: tri({ recType: "album" }) });
      expect(r).toMatchObject({ recs: 1 });
      expect(recs()[0]!.params).toContain("Blonde");
    });

    it("M3: across the whole span only an exact normalized name blocks ambient ('Shogun' at min 2 vs 'Shogun on Hulu' at min 40)", async () => {
      vi.mocked(recsSaidBetween).mockResolvedValueOnce([voiceNote({ name: "Shogun", type: "film_tv", firstName: null, saidAt: new Date(1760600000000 - 38 * 60_000) })]);
      const extractRecommendation = vi.fn(async () => ({ canonicalName: "Shogun on Hulu", creator: null, recommenderName: null, excerpt: "watch it" })) as PipelineDeps["extractRecommendation"];
      const r = await processConversation(42, { ...base, extractRecommendation, bee: bee(), triage: tri({ recType: "film_tv" }) });
      expect(r).toMatchObject({ recs: 1 });
    });

    it("M5: a systemic triage failure throws before the voice-note lookup", async () => {
      await expect(processConversation(42, { ...base, bee: bee(), triage: vi.fn(async () => { throw new Error("down"); }) as PipelineDeps["triage"] })).rejects.toThrow();
      expect(recsSaidBetween).not.toHaveBeenCalled();
    });

    it("M7: without spoken_at the transcript is ordered by id, then by array order", async () => {
      const raw = (text: string, id?: number) => ({ text, speaker: "Unknown", ...(id ? { id } : {}) });
      const triage = tri({});
      await processConversation(42, { ...base, bee: bee("COMPLETED", [raw("Earmark that.", 1), raw("later talk", 3), raw("Ann says try Ardent", 2)] as never), triage });
      expect(vi.mocked(triage).mock.calls[0]![0]).toBe("Unknown: Ann says try Ardent later talk");
      const triage2 = tri({});
      await processConversation(42, { ...base, bee: bee("COMPLETED", [raw("Earmark that."), raw("Ann says try Ardent"), raw("later talk")] as never), triage: triage2 });
      expect(vi.mocked(triage2).mock.calls[0]![0]).toBe("Unknown: Ann says try Ardent later talk");
    });

    it("asks for the voice notes said during the conversation (its span ± 60 s)", async () => {
      await processConversation(42, { ...base, bee: bee("COMPLETED", [spoken(EARMARK, 1)]), triage: tri({}) });
      expect(recsSaidBetween).toHaveBeenCalledWith(new Date(1760600000000 - 60_000), new Date(now().getTime() + 60_000), "journal");
    });

    it("a deliberate earmark a voice note already saved within 60 s is not stored; the log carries ids only", async () => {
      vi.mocked(recsSaidBetween).mockResolvedValueOnce([voiceNote()]);
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const r = await processConversation(42, { ...base, bee: bee("COMPLETED", [spoken(EARMARK, 1)]), triage: tri({}) });
      expect(r).toMatchObject({ skipped: false, recs: 0 });
      expect(recs()).toHaveLength(0);
      expect(log).toHaveBeenCalledWith("[pipeline] same moment: skipped conversation=42 key=u1 rec=156");
      log.mockRestore();
    });

    it("the same name more than 60 s away is a different moment and is stored", async () => {
      vi.mocked(recsSaidBetween).mockResolvedValueOnce([voiceNote({ saidAt: new Date(1760600000000 + 61_002) })]);
      const r = await processConversation(42, { ...base, bee: bee("COMPLETED", [spoken(EARMARK, 1)]), triage: tri({}) });
      expect(r).toMatchObject({ recs: 1 });
    });

    it("an ambient rec named like a voice note from the conversation's span is not stored (normalized name)", async () => {
      vi.mocked(recsSaidBetween).mockResolvedValueOnce([voiceNote({ name: "Ardent (sandwich shop)", firstName: null, saidAt: new Date(1760600000000 + 600_000) })]);
      const r = await processConversation(42, { ...base, bee: bee(), triage: tri({}) });
      expect(r).toMatchObject({ recs: 0 });
      expect(recs()).toHaveLength(0);
    });

    // Real REST transcripts are not in spoken order (11338188: 108 of 311 neighbours out of order), so "the utterance
    // after the trigger" must mean the next one spoken, not the next one in the array.
    it("reads the transcript in spoken order (Bee's array order is not chronological)", async () => {
      const utterances = [spoken("Earmark that.", 1), spoken("somebody else talking far later", 90_000), spoken("Ann says try Ardent on Brady", 2)];
      const triage = tri({});
      await processConversation(42, { ...base, bee: bee("COMPLETED", utterances), triage });
      expect(vi.mocked(triage).mock.calls[0]![0]).toBe("Unknown: Ann says try Ardent on Brady somebody else talking far later");
    });

    it("the earmarked lines never reach ambient triage", async () => {
      const utterances = [spoken(EARMARK, 1), spoken("one", 2), spoken("two", 3)];
      const triage = tri({ kind: "neither" });
      await processConversation(42, { ...base, bee: bee("COMPLETED", utterances), triage });
      const seen = vi.mocked(triage).mock.calls.map((c) => c[0]);
      expect(seen.some((t) => t.includes("Earmark"))).toBe(false);
      expect(seen).toContain("Unknown: Ann says to try Ardent on Brady Street"); // the deliberate planner's own call
    });

    it("a conversation of only earmarks still completes (an empty ambient transcript is not an outage)", async () => {
      const r = await processConversation(42, { ...base, bee: bee("COMPLETED", [spoken(EARMARK, 1)]), triage: tri({}) });
      expect(r).toMatchObject({ skipped: false, recs: 1, incomplete: false });
      expect(releaseConversation).not.toHaveBeenCalled();
    });

    it("an earmark already saved from this conversation is skipped before any model call", async () => {
      vi.mocked(savedDeliberateKeys).mockResolvedValueOnce(new Map([["u1", "Ardent"]]));
      const triage = tri({});
      const r = await processConversation(42, { ...base, bee: bee("COMPLETED", [spoken(EARMARK, 1)]), triage });
      expect(triage).not.toHaveBeenCalled();
      expect(r).toMatchObject({ skipped: false, recs: 0 });
    });

    it("a plain extraction error falls back to a raw needs_review rec; the rest of the conversation still saves", async () => {
      const extractRecommendation = vi.fn(async ({ text }: { text: string }) => {
        if (text.includes("Brady")) throw new Error("bad json");
        return { canonicalName: "Other place", creator: null, recommenderName: null, excerpt: "so about that place" };
      }) as PipelineDeps["extractRecommendation"];
      const utterances = [spoken(EARMARK, 1), spoken("so about that place", 2), spoken("it is great", 3), spoken("really great", 4)];
      const r = await processConversation(42, { ...base, extractRecommendation, bee: bee("COMPLETED", utterances), triage: tri({}) });
      expect(r).toMatchObject({ skipped: false, recs: 2, incomplete: false });
      const raw = recs().find((q) => q.params.includes("u1"))!;
      expect(raw.params).toEqual(expect.arrayContaining(["needs_review", "other", "Ann says to try Ardent on Brady Street", "voice"]));
      expect(releaseConversation).not.toHaveBeenCalled();
    });

    const api = () => new APICallError({ message: "down", url: "https://x", requestBodyValues: {}, statusCode: 503 });
    it.each([
      ["APICallError", api()],
      ["RetryError", new RetryError({ message: "gave up", reason: "maxRetriesExceeded", errors: [api()] })],
      ["TimeoutError", Object.assign(new Error("down"), { name: "TimeoutError" })],
    ])("an outage error (%s) on an earmark releases the claim", async (_name, error) => {
      const extractRecommendation = vi.fn(async () => { throw error; }) as PipelineDeps["extractRecommendation"];
      await expect(processConversation(42, { ...base, extractRecommendation, bee: bee("COMPLETED", [spoken(EARMARK, 1)]), triage: tri({}) })).rejects.toThrow();
      expect(releaseConversation).toHaveBeenCalledWith(42);
    });

    it("on a retry, an earmark saved earlier still keeps ambient from re-saving its name", async () => {
      vi.mocked(savedDeliberateKeys).mockResolvedValueOnce(new Map([["u1", "Ardent"]]));
      const utterances = [spoken(EARMARK, 1), spoken("so about that place", 2), spoken("it is great", 3), spoken("really great", 4)];
      const r = await processConversation(42, { ...base, bee: bee("COMPLETED", utterances), triage: tri({}) });
      expect(r).toMatchObject({ recs: 0 });
      expect(recs()).toHaveLength(0);
    });

    it("a triage outage on a deliberate earmark releases the claim and throws (the person asked for it)", async () => {
      const triage = vi.fn(async () => { throw new Error("gateway down"); }) as unknown as PipelineDeps["triage"];
      await expect(processConversation(42, { ...base, bee: bee("COMPLETED", [spoken(EARMARK, 1)]), triage })).rejects.toBeInstanceOf(SystemicTriageError);
      expect(releaseConversation).toHaveBeenCalledWith(42);
      expect(committed).toHaveLength(0);
    });
  });
});
