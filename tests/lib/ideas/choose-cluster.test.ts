import { describe, expect, it, vi } from "vitest";

vi.mock("../../../agent/lib/env", () => ({ getEnv: () => ({ TRIAGE_MODEL: "typesafe-ai/jev-1.13.0" }) }));
import {
  acceptMatch, buildClusterCriteria, chooseCluster, clusterKey, MATCH_MIN, NEW_IDEA, PINNED_MATCH_MIN, type ClusterOption,
} from "../../../agent/lib/ideas/choose-cluster";

const options: ClusterOption[] = [
  { key: "c_12", title: "AI in public radio newsletter", excerpt: "a newsletter about AI at stations", pinned: false },
  { key: "c_40", title: "Late-night jazz segment", excerpt: null, pinned: true },
];

type DecideArgs = { model: string; state: Record<string, string>; questions: { cluster: { type: string; instructions: string; criteria: Record<string, string> } } };
const decideReturning = (choice: string, p: number) =>
  vi.fn(async (_args: DecideArgs) => ({ answers: { cluster: { type: "choice", choice, probabilities: { [choice]: p } } } }));

describe("clusterKey", () => {
  it("is non-numeric so JS keeps option insertion order", () => {
    expect(clusterKey(12)).toBe("c_12");
  });
});

describe("buildClusterCriteria", () => {
  it("one option per cluster, in order, ending with new_idea; each names the cluster and states the boundary", () => {
    const criteria = buildClusterCriteria(options);
    expect(Object.keys(criteria)).toEqual(["c_12", "c_40", NEW_IDEA]);
    expect(criteria.c_12).toContain("AI in public radio newsletter");
    expect(criteria.c_12).toContain("a newsletter about AI at stations");
    expect(criteria.c_12).toMatch(/format/); // same core proposal even if the format/angle differs
    expect(criteria.c_12).toMatch(/different subject or a different deliverable/);
    expect(criteria[NEW_IDEA]).toMatch(/different subject or a different deliverable/);
  });
  it("never asks Jev to count or compare dates", () => {
    const all = Object.values(buildClusterCriteria(options)).join(" ");
    expect(all).not.toMatch(/how many|count|times|date|before|after|earlier|later/i);
  });
});

describe("acceptMatch", () => {
  it("accepts an existing cluster at or above MATCH_MIN", () => {
    expect(MATCH_MIN).toBe(0.6);
    expect(acceptMatch("c_12", MATCH_MIN, options)).toBe("c_12");
    expect(acceptMatch("c_12", MATCH_MIN - 0.01, options)).toBeNull();
  });
  it("uses the lower threshold for pinned clusters", () => {
    expect(PINNED_MATCH_MIN).toBe(0.4);
    expect(acceptMatch("c_40", PINNED_MATCH_MIN, options)).toBe("c_40");
    expect(acceptMatch("c_40", PINNED_MATCH_MIN - 0.01, options)).toBeNull();
  });
  it("returns null for new_idea, unknown keys and non-finite probabilities", () => {
    expect(acceptMatch(NEW_IDEA, 0.99, options)).toBeNull();
    expect(acceptMatch("c_999", 0.99, options)).toBeNull();
    expect(acceptMatch("c_12", Number.NaN, options)).toBeNull();
  });
});

describe("chooseCluster", () => {
  it("skips the model when there are no options", async () => {
    const decideImpl = decideReturning("c_12", 0.9);
    expect(await chooseCluster({ title: "t", excerpt: "e" }, [], { decideImpl: decideImpl as never })).toEqual({ key: null, choice: NEW_IDEA, probability: 1 });
    expect(decideImpl).not.toHaveBeenCalled();
  });

  it("asks one Choice question on a short state and returns the matched key", async () => {
    const decideImpl = decideReturning("c_12", 0.82);
    const r = await chooseCluster(
      { title: "Newsletter on AI at stations", excerpt: "what if the newsletter covered AI in public radio" }, options, { decideImpl: decideImpl as never },
    );
    expect(r).toEqual({ key: "c_12", choice: "c_12", probability: 0.82 });
    const call = decideImpl.mock.calls[0]![0];
    expect(call.model).toBe("typesafe-ai/jev-1.13.0");
    expect(call.state).toEqual({ mention: "Newsletter on AI at stations: what if the newsletter covered AI in public radio" });
    expect(call.questions.cluster.type).toBe("choice");
    expect(Object.keys(call.questions.cluster.criteria)).toEqual(["c_12", "c_40", NEW_IDEA]);
  });

  it("a match below the threshold becomes a new idea", async () => {
    const r = await chooseCluster({ title: "t", excerpt: "e" }, options, { decideImpl: decideReturning("c_12", 0.55) as never });
    expect(r).toEqual({ key: null, choice: "c_12", probability: 0.55 });
  });

  it("new_idea is a new idea", async () => {
    const r = await chooseCluster({ title: "t", excerpt: "e" }, options, { decideImpl: decideReturning(NEW_IDEA, 0.9) as never });
    expect(r).toEqual({ key: null, choice: NEW_IDEA, probability: 0.9 });
  });

  it("shuffled order (evals) keeps the same option set", async () => {
    const decideImpl = decideReturning(NEW_IDEA, 0.9);
    await chooseCluster({ title: "t", excerpt: "e" }, options, { decideImpl: decideImpl as never, optionOrder: "shuffled" });
    expect(Object.keys(decideImpl.mock.calls[0]![0].questions.cluster.criteria).sort()).toEqual(["c_12", "c_40", NEW_IDEA].sort());
  });
});
