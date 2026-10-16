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
}));

import { isConversationProcessed, markConversationProcessed, releaseConversation } from "../../../agent/lib/store/conversations";
import { processConversation, type PipelineDeps } from "../../../agent/lib/pipeline/process-conversation";
import { SystemicTriageError } from "../../../agent/lib/pipeline/triage";
import type { BeeClient } from "../../../agent/lib/bee/client";
import type { TriageResult } from "../../../agent/lib/types";

const recs = () => committed.filter((q) => /insert into recommendations/.test(q.sql));
const ideas = () => committed.filter((q) => /insert into idea_clusters/.test(q.sql));

const lines = (n: number, text = "you have to try Ardent, Ann says") =>
  Array.from({ length: n }, (_, i) => ({ text: `${text} ${i}`, speaker: "Unknown", spoken_at: 1760600000000 + i }));

function bee(state = "COMPLETED", utterances = lines(4), summary: string | null = null): BeeClient {
  return {
    getConversation: vi.fn(async () => ({
      conversation: { id: 42, start_time: 1760600000000, state, summary, transcriptions: [{ realtime: false, utterances }] },
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
    expect(markConversationProcessed).not.toHaveBeenCalled();
  });

  it("stores an accepted rec with a second-person attribution, and the counts, in one transaction", async () => {
    const r = await processConversation(42, { ...base, bee: bee(), triage: tri({}) });
    // saved ids come from the transaction's own results (statement 1 = the rec insert)
    expect(r).toEqual({ skipped: false, ideas: 0, recs: 1, reviews: 0, failed: 0, saved: { recIds: [1], ideaClusterIds: [], mentionIds: [] } });
    expect(recs()).toHaveLength(1);
    const q = recs()[0]!;
    expect(q.sql).toContain("insert into recommenders");
    expect(q.params).toEqual(expect.arrayContaining(["Ann", "place", "Ardent", "second_person", "new", "ambient", 42, 0.95]));
    expect(committed.some((c) => /update processed_conversations/.test(c.sql) && c.params.includes(1))).toBe(true);
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
    expect(r).toEqual({ skipped: false, ideas: 0, recs: 0, reviews: 0, failed: 0, saved: { recIds: [], ideaClusterIds: [], mentionIds: [] } });
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
    expect((await processConversation(42, { ...base, bee: bee(), triage: tri({}) })).saved).toEqual({ recIds: [], ideaClusterIds: [], mentionIds: [] });
  });

  it("creates an idea cluster for an accepted idea", async () => {
    const r = await processConversation(42, { ...base, bee: bee(), triage: tri({ kind: "idea_by_user" }) });
    expect(r.ideas).toBe(1);
    expect(r.saved).toEqual({ recIds: [], ideaClusterIds: [101], mentionIds: [1] });
    expect(ideas()).toHaveLength(1);
    expect(ideas()[0]!.params).toEqual(expect.arrayContaining(["House music segment", "accepted", "ambient", 42]));
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

  it("rethrows the ORIGINAL error even when releasing the claim also fails", async () => {
    fail.re = /insert into recommendations/;
    fail.nth = 1;
    vi.mocked(releaseConversation).mockRejectedValueOnce(new Error("release failed"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(processConversation(42, { ...base, bee: bee(), triage: tri({}) })).rejects.toThrow("db down");
    spy.mockRestore();
  });
});
