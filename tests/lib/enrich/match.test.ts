import { describe, expect, it, vi } from "vitest";
import { describeCandidate, MATCH_ACCEPT, NONE_FITS, pickMatch } from "../../../agent/lib/enrich/match";
import type { Candidate } from "../../../agent/lib/enrich/types";

// Synthetic candidates only (invented names): no real transcript text in tests or prompts.
const c = (name: string, creator: string | null, detail: string | null = null): Candidate => ({
  canonicalName: name, creator, yearOrAddress: "2021", detail, imageUrl: null, links: {},
});
const decideReturning = (choice: string, probabilities: Record<string, number>) =>
  vi.fn(async () => ({ answers: { match: { type: "choice", choice, probabilities } } }));
const callOf = (decide: ReturnType<typeof decideReturning>) => (decide.mock.calls[0] as unknown as [{ state: unknown; questions: { match: { type: string; criteria: Record<string, string> } } }])[0];

const cands = [c("Night Garden (Remix)", "Someone Else"), c("Night Garden", "Mara Vell", "Album"), c("Night Garden", "The Vell Tribute Band")];
const input = { described: "Night Garden by Mara Vell", excerpt: "you have to hear Night Garden" };

describe("pickMatch", () => {
  it("returns the chosen candidate with its probability when it clears MATCH_ACCEPT", async () => {
    const decide = decideReturning("m_1", { m_0: 0.03, m_1: 0.92, m_2: 0.02, [NONE_FITS]: 0.03 });
    const m = await pickMatch(input, cands, { model: "m", decideImpl: decide as never });
    expect(m).toMatchObject({ canonicalName: "Night Garden", creator: "Mara Vell", matchConfidence: 0.92 });
  });

  it("abstains when Jev chooses none_fits", async () => {
    const decide = decideReturning(NONE_FITS, { m_0: 0.1, m_1: 0.1, m_2: 0.1, [NONE_FITS]: 0.7 });
    expect(await pickMatch(input, cands, { model: "m", decideImpl: decide as never })).toBeNull();
  });

  it("returns null when the chosen candidate is below MATCH_ACCEPT", async () => {
    const decide = decideReturning("m_1", { m_1: MATCH_ACCEPT - 0.01 });
    expect(await pickMatch(input, cands, { model: "m", decideImpl: decide as never })).toBeNull();
  });

  it("returns null for an unknown key or a missing distribution", async () => {
    expect(await pickMatch(input, cands, { model: "m", decideImpl: decideReturning("m_9", { m_9: 0.99 }) as never })).toBeNull();
    expect(await pickMatch(input, cands, { model: "m", decideImpl: decideReturning("m_1", {}) as never })).toBeNull();
  });

  it("asks nothing when there are no candidates", async () => {
    const decide = decideReturning("m_0", {});
    expect(await pickMatch(input, [], { model: "m", decideImpl: decide as never })).toBeNull();
    expect(decide).not.toHaveBeenCalled();
  });

  it("asks one choice question: described item and excerpt in state, each candidate plus none_fits as options", async () => {
    const decide = decideReturning(NONE_FITS, { [NONE_FITS]: 1 });
    await pickMatch(input, cands, { model: "m", decideImpl: decide as never, random: () => 0.99 });
    const call = callOf(decide);
    expect(call.state).toEqual({ described_item: input.described, what_was_said: input.excerpt });
    expect(call.questions.match.type).toBe("choice");
    const criteria = call.questions.match.criteria as Record<string, string>;
    expect(Object.keys(criteria).sort()).toEqual(["m_0", "m_1", "m_2", NONE_FITS].sort());
    expect(criteria.m_1).toContain(describeCandidate(cands[1]!));
  });

  it("shuffles option order (Jev leans toward the first option)", async () => {
    const orders = new Set<string>();
    for (const r of [0, 0.3, 0.6, 0.99]) {
      const decide = decideReturning(NONE_FITS, { [NONE_FITS]: 1 });
      await pickMatch(input, cands, { model: "m", decideImpl: decide as never, random: () => r });
      orders.add(Object.keys(callOf(decide).questions.match.criteria).join(","));
    }
    expect(orders.size).toBeGreaterThan(1);
  });
});

describe("describeCandidate", () => {
  it("joins the known parts", () => {
    expect(describeCandidate(c("Night Garden", "Mara Vell", "Album"))).toBe("Night Garden — Mara Vell — 2021 — Album");
    expect(describeCandidate({ ...c("X", null), yearOrAddress: null })).toBe("X");
  });
});
