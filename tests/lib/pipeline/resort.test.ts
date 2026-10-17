import { describe, expect, it } from "vitest";
import { planClusters, planResort, type ResortRow } from "../../../agent/lib/pipeline/resort";

const rec = (status: string, confidence: number | null, over: Partial<ResortRow> = {}): ResortRow => ({
  table: "recommendations", id: 1, status, confidence, source: "ambient", deliberateKey: null, ...over,
});
const mention = (status: string, confidence: number | null, over: Partial<ResortRow> = {}): ResortRow => ({
  table: "idea_mentions", id: 2, status, confidence, source: "ambient", deliberateKey: null, ...over,
});
const to = (row: ResortRow) => planResort([row])[0]?.to ?? "unchanged";

describe("planResort — recommendations (M2-T10b, decision 010)", () => {
  it.each([
    ["new", 0.95, "unchanged"],
    ["new", 0.9, "needs_review"], // exactly ACCEPT_ABOVE is review
    ["new", 0.75, "needs_review"],
    ["new", 0.6, "needs_review"], // exactly DROP_BELOW is review
    ["new", 0.5999, "dismissed"],
    ["new", 0, "dismissed"],
    ["needs_review", 0.9000001, "new"],
    ["needs_review", 0.9, "unchanged"],
    ["needs_review", 0.6, "unchanged"],
    ["needs_review", 0.5999, "dismissed"],
  ] as const)("%s at p=%s → %s", (status, p, want) => {
    expect(to(rec(status, p))).toBe(want);
  });

  it.each(["queued", "tried", "thanked", "composted", "dismissed"])("never touches a %s rec (Tarik's action or terminal)", (status) => {
    for (const p of [0, 0.5, 0.75, 0.95]) expect(to(rec(status, p))).toBe("unchanged");
  });
});

describe("planResort — idea mentions", () => {
  it.each([
    ["accepted", 0.95, "unchanged"],
    ["accepted", 0.9, "needs_review"],
    ["accepted", 0.6, "needs_review"],
    ["accepted", 0.5999, "dismissed"],
    ["needs_review", 0.95, "accepted"],
    ["needs_review", 0.9, "unchanged"],
    ["needs_review", 0.5999, "dismissed"],
  ] as const)("%s at p=%s → %s", (status, p, want) => {
    expect(to(mention(status, p))).toBe(want);
  });

  it("never touches a dismissed mention (dismissed stays dismissed, decision 004)", () => {
    for (const p of [0, 0.75, 0.95]) expect(to(mention("dismissed", p))).toBe("unchanged");
  });
});

describe("planResort — rows it must leave alone", () => {
  it.each([Number.NaN, null, Number.POSITIVE_INFINITY])("confidence %s → unchanged", (p) => {
    expect(to(rec("new", p))).toBe("unchanged");
    expect(to(mention("accepted", p))).toBe("unchanged");
  });

  it("excludes deliberate captures: source voice (voice notes, Earmark that, raw fallbacks)", () => {
    expect(to(rec("new", 0.1, { source: "voice" }))).toBe("unchanged");
    expect(to(rec("needs_review", 1, { source: "voice" }))).toBe("unchanged");
    expect(to(mention("accepted", 0.1, { source: "voice" }))).toBe("unchanged");
  });

  it("excludes any row carrying a deliberate_key, whatever its source", () => {
    expect(to(rec("new", 0.1, { deliberateKey: "u123" }))).toBe("unchanged");
    expect(to(mention("accepted", 0.1, { deliberateKey: "i4" }))).toBe("unchanged");
  });

  it.each(["photo", "song", "email"])("excludes %s captures (never triaged by confidence)", (source) => {
    expect(to(rec("new", 0.1, { source }))).toBe("unchanged");
  });

  it("returns ids, tables, old and new status, and the confidence", () => {
    expect(planResort([rec("new", 0.3, { id: 7 }), mention("accepted", 0.95, { id: 8 }), mention("accepted", 0.7, { id: 9 })])).toEqual([
      { table: "recommendations", id: 7, from: "new", to: "dismissed", confidence: 0.3 },
      { table: "idea_mentions", id: 9, from: "accepted", to: "needs_review", confidence: 0.7 },
    ]);
  });
});

describe("planClusters — counts follow non-dismissed mentions, stage via stageFor", () => {
  it("a dismissed mention lowers the count and the stage; a review-band one still counts", () => {
    const out = planClusters(
      [
        { clusterId: 1, from: "needs_review", to: "dismissed" },
        { clusterId: 1, from: "accepted", to: "needs_review" },
      ],
      [{ id: 1, stage: "ready", mentionCount: 3 }],
    );
    expect(out).toEqual([{ id: 1, fromStage: "ready", toStage: "sprouting", fromCount: 3, toCount: 2 }]);
  });

  it("drafted / used / dismissed ideas keep their stage while the count drops", () => {
    expect(planClusters([{ clusterId: 5, from: "accepted", to: "dismissed" }], [{ id: 5, stage: "drafted", mentionCount: 1 }]))
      .toEqual([{ id: 5, fromStage: "drafted", toStage: "drafted", fromCount: 1, toCount: 0 }]);
  });

  it("an un-dismissed mention (undo) raises the count back", () => {
    expect(planClusters([{ clusterId: 2, from: "dismissed", to: "needs_review" }], [{ id: 2, stage: "sprouting", mentionCount: 2 }]))
      .toEqual([{ id: 2, fromStage: "sprouting", toStage: "ready", fromCount: 2, toCount: 3 }]);
  });

  it("leaves a cluster out when only accepted ↔ needs_review moved (count unchanged)", () => {
    expect(planClusters([{ clusterId: 1, from: "accepted", to: "needs_review" }], [{ id: 1, stage: "compost", mentionCount: 1 }])).toEqual([]);
  });

  it("never goes below zero", () => {
    expect(planClusters([{ clusterId: 3, from: "accepted", to: "dismissed" }], [{ id: 3, stage: "compost", mentionCount: 0 }]))
      .toEqual([]);
  });
});
