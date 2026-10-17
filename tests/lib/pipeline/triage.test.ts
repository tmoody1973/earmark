import { describe, expect, it } from "vitest";
import { experimental_decide } from "ai";
import { Experimental_DecisionMockModelV4 as MockDecisionModel } from "ai/test";
import { KIND_CRITERIA, REC_TYPE_CRITERIA } from "../../../agent/lib/pipeline/criteria";
import { triageWindow } from "../../../agent/lib/pipeline/triage";

function dist(options: string[], chosen: string, p: number): Record<string, number> {
  const rest = (1 - p) / (options.length - 1);
  return Object.fromEntries(options.map((o) => [o, o === chosen ? p : rest]));
}

function mockDecide(opts: { kind: string; p: number; recType: string; joking: number; broadcast?: number }, seen: string[][] = []) {
  const model = new MockDecisionModel({
    doDecide: async ({ questions }) => {
      seen.push(Object.keys((questions.kind as { criteria: Record<string, unknown> }).criteria));
      return {
        answers: {
          kind: { type: "choice", choice: opts.kind, probabilities: dist(Object.keys(KIND_CRITERIA), opts.kind, opts.p) },
          rec_type: { type: "choice", choice: opts.recType, probabilities: dist(Object.keys(REC_TYPE_CRITERIA), opts.recType, 0.8) },
          joking: { type: "boolean", probability: opts.joking },
          broadcast: { type: "boolean", probability: opts.broadcast ?? 0.01 },
        },
        warnings: [],
      };
    },
  });
  return ((args: Parameters<typeof experimental_decide>[0]) =>
    experimental_decide({ ...args, model })) as unknown as typeof experimental_decide;
}

describe("triageWindow", () => {
  it("maps the broadcast answer into broadcastProbability", async () => {
    const r = await triageWindow("Unknown: this episode is brought to you by BetterHelp", {
      model: "typesafe-ai/jev-1.13.0",
      decideImpl: mockDecide({ kind: "rec_to_user", p: 0.9, recType: "other", joking: 0.05, broadcast: 0.93 }),
    });
    expect(r.broadcastProbability).toBeCloseTo(0.93);
  });

  it("maps the decision into a TriageResult", async () => {
    const r = await triageWindow("Unknown: you have to try Kopp's", {
      model: "typesafe-ai/jev-1.13.0",
      decideImpl: mockDecide({ kind: "rec_to_user", p: 0.9, recType: "place", joking: 0.05 }),
    });
    expect(r.kind).toBe("rec_to_user");
    expect(r.kindProbability).toBeCloseTo(0.9);
    expect(r.recType).toBe("place");
    expect(r.recTypeProbability).toBeCloseTo(0.8);
    expect(r.jokingProbability).toBeCloseTo(0.05);
    expect(r.model).toBe("typesafe-ai/jev-1.13.0");
  });

  it("keeps option order fixed by default", async () => {
    const seen: string[][] = [];
    for (let i = 0; i < 3; i++) {
      await triageWindow("x", { model: "m", decideImpl: mockDecide({ kind: "neither", p: 0.9, recType: "none", joking: 0 }, seen) });
    }
    expect(seen.every((keys) => keys.join() === Object.keys(KIND_CRITERIA).join())).toBe(true);
  });

  it("shuffles option order when asked, keeping the same options", async () => {
    const seen: string[][] = [];
    for (let i = 0; i < 20; i++) {
      await triageWindow("x", {
        model: "m",
        optionOrder: "shuffled",
        decideImpl: mockDecide({ kind: "neither", p: 0.9, recType: "none", joking: 0 }, seen),
      });
    }
    expect(new Set(seen.map((k) => k[0])).size).toBeGreaterThan(1);
    for (const keys of seen) expect([...keys].sort()).toEqual(Object.keys(KIND_CRITERIA).sort());
  });

  it("has no integer-like option keys (JS would reorder them and defeat shuffling)", () => {
    for (const k of [...Object.keys(KIND_CRITERIA), ...Object.keys(REC_TYPE_CRITERIA)]) expect(k).not.toMatch(/^\d+$/);
  });

  it("offers video as a rec type with its boundary cases, and no longer files YouTube under other", () => {
    expect(REC_TYPE_CRITERIA.video).toMatch(/YouTube/);
    expect(REC_TYPE_CRITERIA.video).toMatch(/TikTok/);
    expect(REC_TYPE_CRITERIA.video).toMatch(/film_tv/);
    expect(REC_TYPE_CRITERIA.video).toMatch(/podcast/);
    expect(REC_TYPE_CRITERIA.film_tv).toMatch(/is video, not this/);
    expect(REC_TYPE_CRITERIA.other).not.toMatch(/YouTube/);
  });

  it("lists neither first so position bias favours dropping", () => {
    expect(Object.keys(KIND_CRITERIA)[0]).toBe("neither");
  });

  it("keeps the rewritten rec_to_user boundary wording", () => {
    expect(KIND_CRITERIA.rec_to_user).toContain("Dana told me to check out");
    expect(KIND_CRITERIA.rec_by_user).toContain("is rec_to_user, not this option");
  });

  // M2-T10: Jev called 30 work-talk runs rec_to_user and 22 idea_by_user. Naming a thing at work is not recommending it.
  it("keeps the work-talk boundary cases (naming a tool or company while working is neither)", () => {
    expect(KIND_CRITERIA.neither).toContain("we exported the chart from Datawrapper");
    expect(KIND_CRITERIA.neither).toContain("Naming a thing is not recommending it");
    expect(KIND_CRITERIA.rec_to_user).toContain("for their own use or enjoyment");
    expect(KIND_CRITERIA.idea_by_user).toContain("must say what would be made or done");
  });

  it("says 'talking about work' in both neither and rec_to_user, and keeps office recs and proposals out of neither", () => {
    expect(KIND_CRITERIA.neither).toContain("talking about work");
    expect(KIND_CRITERIA.rec_to_user).toContain("talking about work");
    expect(KIND_CRITERIA.neither).toContain("a proposal naming what to make or air is idea_by_user, not neither");
    expect(KIND_CRITERIA.rec_to_user).toContain("you have to try the new ramen place");
  });

  it("gives rec_by_user only audience-addressed examples (none that a one-to-one rec could match)", () => {
    expect(KIND_CRITERIA.rec_by_user).not.toContain("if you shoot video");
    expect(KIND_CRITERIA.rec_by_user).toContain("everyone watching");
  });

  it("uses NaN probabilities when the provider omits them", async () => {
    const model = new MockDecisionModel({
      doDecide: async () => ({
        answers: {
          kind: { type: "choice", choice: "neither" },
          rec_type: { type: "choice", choice: "none" },
          joking: { type: "boolean", probability: 0 },
          broadcast: { type: "boolean", probability: 0 },
        },
        warnings: [],
      }),
    });
    const decideImpl = ((args: Parameters<typeof experimental_decide>[0]) =>
      experimental_decide({ ...args, model })) as unknown as typeof experimental_decide;
    const r = await triageWindow("x", { model: "m", decideImpl });
    expect(r.kindProbability).toBeNaN();
    expect(r.recTypeProbability).toBeNaN();
  });
});
