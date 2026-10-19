import { beforeEach, describe, expect, it, vi } from "vitest";
import { experimental_decide } from "ai";
import { Experimental_DecisionMockModelV4 as MockDecisionModel } from "ai/test";

// Fake Neon tag: each statement is recorded and answered from `answers` in order (default: no rows).
const statements: { sql: string; params: unknown[] }[] = [];
const answers: Record<string, unknown>[][] = [];
vi.mock("../../../agent/lib/db", () => ({
  db: () => async (strings: TemplateStringsArray, ...params: unknown[]) => {
    statements.push({ sql: strings.join("?"), params });
    return answers.shift() ?? [];
  },
}));

import { SWEEP_SKIPS_STATUSES } from "../../../agent/lib/recs/lane";
import {
  applyTipFixProposal, CLEARED_STATUSES, closestTips, ignoreTipFixProposal, MAX_TIP_CANDIDATES, pickTip, planSpokenFix, type RecentTip,
} from "../../../agent/lib/recs/spoken-fix";

// Invented tips and sentences only.
const tip = (id: number, canonical_name: string, creator: string | null = null, type: RecentTip["type"] = "album"): RecentTip =>
  ({ id, type, canonical_name, creator, context_summary: null });
const TIPS = [
  tip(1, "Velvet Moth"), tip(2, "Corla Pine's new albums", "Corla Pine"), tip(3, "Kawa Raymond", null, "place"),
  tip(4, "Glass Harbor", "Mara Vell"), tip(5, "Night Garden", "Mara Vell"),
];

beforeEach(() => {
  statements.length = 0;
  answers.length = 0;
});

it("never proposes for a tip the fix itself would refuse: the same cleared statuses as the lane", () => {
  expect([...CLEARED_STATUSES].sort()).toEqual([...SWEEP_SKIPS_STATUSES].sort());
});

describe("closestTips", () => {
  it("ranks recent tips by how close their words are to what the owner called it, at most MAX_TIP_CANDIDATES", () => {
    const got = closestTips("the Corla Pine album", TIPS);
    expect(got[0]!.id).toBe(2);
    expect(got).toHaveLength(MAX_TIP_CANDIDATES);
    expect(closestTips("Velvet Mouth", TIPS)[0]!.id).toBe(1); // misheard again, still nearest
  });

  it("finds a tip whose misheard word is only in its note (the real case, invented names), among decoys", () => {
    // Shaped like tip 150: name and creator lack the misheard words; the why line holds them.
    const target: RecentTip = { ...tip(20, "Corla Pine's new albums", "Corla Pine"), context_summary: "Said to be a tribute to Velvet Moth Records." };
    const decoys = [
      tip(21, "Velvet Underground & Nico", "The Velvet Underground"), tip(22, "Moth Smoke", "Mohsin Hamid", "book"),
      tip(23, "Moths of the Night Garden", "Mara Vell"), tip(24, "Records of the Sun", "Sundial Quartet"),
      tip(25, "Raw Velvet", null, "song"), tip(26, "Velvet Room Bar", null, "place"),
    ];
    expect(closestTips("Velvet Moth", [...decoys, target]).map((t) => t.id)).toContain(20);
  });

  it("no tips, no candidates", () => {
    expect(closestTips("Velvet Moth", [])).toEqual([]);
  });
});

function decideWith(choice: (keys: string[]) => string, p: number, seen: string[][] = []) {
  const model = new MockDecisionModel({
    doDecide: async ({ questions }) => {
      const keys = Object.keys((questions.tip as { criteria: Record<string, unknown> }).criteria);
      seen.push(keys);
      const c = choice(keys);
      return { answers: { tip: { type: "choice", choice: c, probabilities: Object.fromEntries(keys.map((k) => [k, k === c ? p : (1 - p) / (keys.length - 1)])) } }, warnings: [] };
    },
  });
  return ((args: Parameters<typeof experimental_decide>[0]) => experimental_decide({ ...args, model })) as unknown as typeof experimental_decide;
}

describe("pickTip (Jev, with an abstain option)", () => {
  const cands = [TIPS[0]!, TIPS[3]!];
  const said = { said: "Velvet Moth tip should be Velvet Mouth", heardAs: "Velvet Moth" };

  it("returns the tip Jev picks when it is at least 0.8 sure; the options include none_fits", async () => {
    const seen: string[][] = [];
    const got = await pickTip(said, cands, { model: "m", decideImpl: decideWith(() => "t_0", 0.9, seen) });
    expect(got?.id).toBe(1);
    expect(seen[0]).toEqual(expect.arrayContaining(["t_0", "t_1", "none_fits"]));
  });

  it("each option shows Jev the tip's note, clipped, so a misheard word that lives only there can be matched", async () => {
    let criteria: Record<string, string> = {};
    const model = new MockDecisionModel({
      doDecide: async ({ questions }) => {
        criteria = (questions.tip as { criteria: Record<string, string> }).criteria;
        const keys = Object.keys(criteria);
        return { answers: { tip: { type: "choice", choice: "none_fits", probabilities: Object.fromEntries(keys.map((k) => [k, k === "none_fits" ? 1 : 0])) } }, warnings: [] };
      },
    });
    const decideImpl = ((args: Parameters<typeof experimental_decide>[0]) => experimental_decide({ ...args, model })) as unknown as typeof experimental_decide;
    const noted: RecentTip = { ...tip(20, "Corla Pine's new albums", "Corla Pine"), context_summary: `Said to be a tribute to Velvet Moth Records. ${"x".repeat(300)}` };
    await pickTip(said, [noted], { model: "m", decideImpl });
    const option = Object.entries(criteria).find(([k]) => k !== "none_fits")![1];
    expect(option).toContain("Corla Pine's new albums by Corla Pine (album) — note: Said to be a tribute to Velvet Moth Records.");
    expect(option).not.toContain("x".repeat(130)); // clipped
  });

  it("abstains: none_fits, or a pick below 0.8", async () => {
    expect(await pickTip(said, cands, { model: "m", decideImpl: decideWith(() => "none_fits", 0.9) })).toBeNull();
    expect(await pickTip(said, cands, { model: "m", decideImpl: decideWith(() => "t_0", 0.6) })).toBeNull();
  });
});

describe("planSpokenFix", () => {
  const where = { beeConversationId: 77, beeJournalId: null };
  const deps = (over: Partial<Parameters<typeof planSpokenFix>[2]> = {}) => ({
    extract: vi.fn(async () => ({ heardAs: "Corla Pine album", name: "Glass Harbor", creator: "Mara Vell", type: null })),
    recentTips: vi.fn(async () => TIPS),
    pick: vi.fn(async (_s: unknown, c: readonly RecentTip[]) => c.find((t) => t.id === 2) ?? null),
    ...over,
  });

  it("proposes the owner's words for the tip Jev picked: name and creator said, type unsaid stays out", async () => {
    const d = deps();
    const got = await planSpokenFix("the Corla Pine album is actually Glass Harbor by Mara Vell", where, d);
    expect(got).toEqual({ recId: 2, fix: { name: "Glass Harbor", creator: "Mara Vell" }, beeConversationId: 77, beeJournalId: null });
    expect(vi.mocked(d.pick).mock.calls[0]![0]).toEqual({ said: "the Corla Pine album is actually Glass Harbor by Mara Vell", heardAs: "Corla Pine album" });
    expect(vi.mocked(d.pick).mock.calls[0]![1][0]!.id).toBe(2); // the closest first
  });

  it("a type said out loud is part of the fix", async () => {
    const d = deps({
      extract: vi.fn(async () => ({ heardAs: "Velvet Moth", name: "Velvet Mouth", creator: null, type: "artist" as const })),
      pick: vi.fn(async (_s: unknown, c: readonly RecentTip[]) => c.find((t) => t.id === 1) ?? null),
    });
    expect(await planSpokenFix("Velvet Moth tip should be Velvet Mouth, the band", where, d)).toMatchObject({ recId: 1, fix: { name: "Velvet Mouth", type: "artist" } });
  });

  it("Jev can't tell which tip: nothing", async () => {
    expect(await planSpokenFix("that tip is wrong", where, deps({ pick: vi.fn(async () => null) }))).toBeNull();
  });

  it("no recent tips: nothing, and Jev is never asked", async () => {
    const d = deps({ recentTips: vi.fn(async () => []) });
    expect(await planSpokenFix("Velvet Moth should be Velvet Mouth", where, d)).toBeNull();
    expect(d.pick).not.toHaveBeenCalled();
  });

  it("the tip already says that: nothing to propose", async () => {
    const d = deps({ extract: vi.fn(async () => ({ heardAs: "Corla Pine", name: "Corla Pine's new albums", creator: "Corla Pine", type: null })) });
    expect(await planSpokenFix("the Corla Pine tip is Corla Pine's new albums", where, d)).toBeNull();
  });
});

describe("proposal state: Apply / Ignore", () => {
  const PENDING = [{ rec_id: 2, name: "Glass Harbor", creator: "Mara Vell", type: null }];

  it("Apply claims the proposal, then applies the fix once through applyTipFix", async () => {
    answers.push(PENDING);
    const apply = vi.fn(async () => ({ changed: true, requeued: true }));
    expect(await applyTipFixProposal(9, apply)).toEqual({ changed: true });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(2, { name: "Glass Harbor", creator: "Mara Vell" });
    expect(statements[0]!.sql).toMatch(/set status = 'applied'[\s\S]*status = 'pending'/);
  });

  it("a second Apply finds nothing pending: applyTipFix is not called again", async () => {
    const apply = vi.fn(async () => ({ changed: true, requeued: true }));
    expect(await applyTipFixProposal(9, apply)).toEqual({ changed: false });
    expect(apply).not.toHaveBeenCalled();
  });

  it("the tip was cleared (or changed) since: refused, and the proposal is pending again", async () => {
    answers.push(PENDING);
    const apply = vi.fn(async () => ({ changed: false, requeued: false }));
    expect(await applyTipFixProposal(9, apply)).toEqual({ changed: false, refused: true });
    expect(statements[1]!.sql).toMatch(/set status = 'pending'/);
  });

  it("applyTipFix throwing reopens the proposal and rethrows", async () => {
    answers.push(PENDING);
    await expect(applyTipFixProposal(9, vi.fn(async () => { throw new Error("db down"); }))).rejects.toThrow("db down");
    expect(statements[1]!.sql).toMatch(/set status = 'pending'/);
  });

  it("Ignore dismisses a pending proposal once; again is a no-op", async () => {
    answers.push([{ id: 9 }]);
    expect(await ignoreTipFixProposal(9)).toEqual({ changed: true });
    expect(statements[0]!.sql).toMatch(/set status = 'ignored'[\s\S]*status = 'pending'/);
    expect(await ignoreTipFixProposal(9)).toEqual({ changed: false });
  });

  it("refuses a bad id before any read", async () => {
    await expect(applyTipFixProposal(0)).rejects.toThrow(RangeError);
    await expect(ignoreTipFixProposal(-1)).rejects.toThrow(RangeError);
    expect(statements).toEqual([]);
  });
});
