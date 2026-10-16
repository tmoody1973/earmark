import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../agent/lib/env", () => ({
  getEnv: () => ({ TRIAGE_MODEL: "typesafe-ai/jev-1.13.0", WRITE_MODEL: "anthropic/claude-sonnet-5.5" }),
}));
const store = vi.hoisted(() => ({
  claimDraftableClusters: vi.fn(async (_o: { clusterIds?: number[]; limit: number }) => [] as number[]),
  getClusterForDraft: vi.fn(),
  releaseDraftClaim: vi.fn(async (_id: number) => {}),
  saveDraft: vi.fn((_txn: unknown, _id: number, _md: string, _f: string) => "save-statement"),
}));
vi.mock("../../../agent/lib/store/ideas", () => store);
const tx = vi.hoisted(() => ({ rows: [[{ id: 12 }]] as unknown[][], statements: [] as unknown[] }));
vi.mock("../../../agent/lib/db", () => ({
  db: () => ({
    transaction: async (fn: (txn: unknown) => unknown[]) => {
      tx.statements = fn("txn");
      return tx.rows;
    },
  }),
}));

import {
  chooseDraftFormat, DRAFT_FORMAT_CRITERIA, DraftLengthError, draftBlooms, draftOnePagerForCluster, enforceQuoteLimit,
  factsFromKeyword, mentionDatesLine, relatedFromNeural, writeOnePager,
} from "../../../agent/lib/ideas/one-pager";
import { ONE_PAGER_PROMPT } from "../../../agent/lib/ideas/one-pager-prompt";
import { wordCount } from "../../../agent/lib/pipeline/excerpt";

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");

beforeEach(() => {
  vi.clearAllMocks();
  tx.rows = [[{ id: 12 }]];
  tx.statements = [];
});

describe("mentionDatesLine", () => {
  it("lists the mention dates oldest first (Chicago calendar days), whatever order they arrive in", () => {
    const line = mentionDatesLine([new Date("2026-10-15T15:00:00Z"), new Date("2026-09-12T15:00:00Z"), new Date("2026-10-03T15:00:00Z")]);
    expect(line).toBe("Mentioned 3 times: Sep 12 · Oct 3 · Oct 15");
  });
});

describe("enforceQuoteLimit", () => {
  it("clamps any quotation longer than 25 words, straight or curly", () => {
    const out = enforceQuoteLimit(`She said "${words(30)}" and “${words(40)}”.`);
    const quotes = [...out.matchAll(/["“]([^"”]+)["”]/g)];
    expect(quotes).toHaveLength(2);
    for (const m of quotes) expect(wordCount(m[1]!)).toBeLessThanOrEqual(25);
  });
  it("leaves short quotes and unquoted text alone", () => {
    const text = `He said "go twice".\n\n${words(60)}`;
    expect(enforceQuoteLimit(text)).toBe(text);
  });
});

describe("relatedFromNeural", () => {
  it("uses short summaries, falls back to a capped detailed summary, never anything else", () => {
    const out = relatedFromNeural([
      { id: 1, locations: [], short_summary: "Talked about AI at stations", detailed_summary: "long" },
      { id: 2, locations: [], short_summary: null, detailed_summary: "x".repeat(900) },
      { id: 3, locations: [], short_summary: null, detailed_summary: null },
    ]);
    expect(out).toEqual(["Talked about AI at stations", "x".repeat(400)]);
  });
  it("keeps at most 5", () => {
    expect(relatedFromNeural(Array.from({ length: 8 }, (_, i) => ({ id: i, locations: [], short_summary: `s${i}` })))).toHaveLength(5);
  });
});

describe("factsFromKeyword", () => {
  it("takes fact results only, text from summary else snippet", () => {
    expect(factsFromKeyword([
      { id: "f1", type: "fact", summary: "Writes The Intersection newsletter", snippet: "Writes" },
      { id: "f2", type: "fact", summary: null, snippet: "Hosts Rhythm Lab" },
      { id: "f3", type: "fact", summary: "", snippet: "" },
      { id: "c9", type: "conversation", summary: "Not a fact", snippet: null },
    ])).toEqual(["Writes The Intersection newsletter", "Hosts Rhythm Lab"]);
  });
});

describe("chooseDraftFormat", () => {
  it("asks Jev one Choice over the three formats with the idea and its excerpts as state (no dates)", async () => {
    const decideImpl = vi.fn(async (_o: unknown) => ({ answers: { format: { type: "choice", choice: "radio_segment", probabilities: { radio_segment: 0.77 } } } }));
    const r = await chooseDraftFormat({ title: "Record store segment", excerpts: ["a weekly segment on record stores"] }, { decideImpl: decideImpl as never });
    expect(r).toEqual({ format: "radio_segment", probability: 0.77 });
    const call = (decideImpl.mock.calls[0] as unknown as [{ model: string; state: unknown; questions: { format: { criteria: object } } }])[0];
    expect(call.model).toBe("typesafe-ai/jev-1.13.0");
    expect(call.state).toEqual({ idea: "Record store segment", mentions: "- a weekly segment on record stores" });
    expect(Object.keys(call.questions.format.criteria)).toEqual(Object.keys(DRAFT_FORMAT_CRITERIA));
  });

  it("criteria carry boundary cases: radio as the subject is not radio as the medium", () => {
    expect(DRAFT_FORMAT_CRITERIA.product_brief).toMatch(/radio station/i);
    expect(DRAFT_FORMAT_CRITERIA.radio_segment).toMatch(/only the subject/i);
    expect(DRAFT_FORMAT_CRITERIA.newsletter_pitch).toMatch(/Do not choose/);
  });

  it("rejects an answer that is not one of the three formats", async () => {
    const decideImpl = vi.fn(async () => ({ answers: { format: { type: "choice", choice: "podcast" } } }));
    await expect(chooseDraftFormat({ title: "x", excerpts: ["y"] }, { decideImpl: decideImpl as never })).rejects.toThrow();
  });
});

describe("writeOnePager", () => {
  const input = {
    title: "CRM for public radio", format: "product_brief" as const,
    timelineLines: ["Sep 12: first heard", "Oct 3: added donor tracking"], excerpts: ['Sep 12: "a CRM for public radio"'],
    related: ["Earlier chat about station tools"], facts: ["Works at Radio Milwaukee"],
  };

  it("writes with the WRITE model and the shared prompt, giving it every input and only those", async () => {
    const generateImpl = vi.fn(async (_o: unknown) => ({ text: `  ${words(400)}  ` }));
    expect(await writeOnePager(input, { generateImpl: generateImpl as never })).toBe(words(400));
    const call = (generateImpl.mock.calls[0] as unknown as [{ model: string; instructions: string; prompt: string }])[0];
    expect(call.model).toBe("anthropic/claude-sonnet-5.5");
    expect(call.instructions).toBe(ONE_PAGER_PROMPT);
    for (const s of ["product_brief", "CRM for public radio", "Sep 12: first heard", 'Sep 12: "a CRM for public radio"', "Earlier chat about station tools", "Works at Radio Milwaukee"]) {
      expect(call.prompt).toContain(s);
    }
  });

  it("throws DraftLengthError outside 300–700 words", async () => {
    for (const n of [299, 701]) {
      const generateImpl = vi.fn(async () => ({ text: words(n) }));
      await expect(writeOnePager(input, { generateImpl: generateImpl as never })).rejects.toBeInstanceOf(DraftLengthError);
    }
  });
});

describe("ONE_PAGER_PROMPT", () => {
  it("states the hard rules: no invention, first names, 25-word quotes, plain text headings, the length", () => {
    expect(ONE_PAGER_PROMPT).toMatch(/Never invent/);
    expect(ONE_PAGER_PROMPT).toMatch(/first name/i);
    expect(ONE_PAGER_PROMPT).toMatch(/25 words/);
    expect(ONE_PAGER_PROMPT).toMatch(/## /);
    expect(ONE_PAGER_PROMPT).toMatch(/350/);
    for (const f of Object.keys(DRAFT_FORMAT_CRITERIA)) expect(ONE_PAGER_PROMPT).toContain(`${f}:`);
  });
});

describe("draftBlooms", () => {
  // Stored in processing order (not date order), as buildSaveQueries appends them.
  const cluster = {
    id: 12, title: "AI in public radio newsletter",
    timeline: [
      { date: "2026-10-03T15:00:00.000Z", line: "Oct 3: added a radio segment angle" },
      { date: "2026-09-12T15:00:00.000Z", line: "Sep 12: first heard" },
      { date: "2026-10-15T15:00:00.000Z", line: "Oct 15: named three station GMs as guests" },
    ],
    mentions: [
      { excerpt: "maybe a radio segment too", spokenAt: new Date("2026-10-03T15:00:00Z") },
      { excerpt: `a newsletter about AI in public radio ${words(30)}`, spokenAt: new Date("2026-09-12T15:00:00Z") },
      { excerpt: "guests could be three station GMs", spokenAt: new Date("2026-10-15T15:00:00Z") },
    ],
  };
  const deps = () => ({
    bee: {
      neuralSearch: vi.fn(async (_q: string, _o: unknown) => ({ results: [{ id: 812, locations: [], short_summary: "Earlier chat about AI tools at the station", detailed_summary: "…" }] })),
      keywordSearch: vi.fn(async (_q: string, _o: unknown) => ({ results: [{ id: "f_31", type: "fact", summary: "Writes The Intersection newsletter", snippet: null }] })),
    },
    chooseDraftFormat: vi.fn(async (_i: unknown) => ({ format: "newsletter_pitch" as const, probability: 0.8 })),
    writeOnePager: vi.fn(async (_i: unknown) => `# AI at the station\n\n## The pitch\nShe said "${words(30)}".`),
  });

  it("claims, gathers sorted dated material plus Bee context, then saves draft + stage in one transaction", async () => {
    store.claimDraftableClusters.mockResolvedValueOnce([12]);
    store.getClusterForDraft.mockResolvedValueOnce(cluster);
    const d = deps();
    const out = await draftBlooms({ clusterIds: [12], deps: d as never });

    expect(store.claimDraftableClusters).toHaveBeenCalledWith({ clusterIds: [12], limit: 3 });
    expect(d.bee.neuralSearch).toHaveBeenCalledWith("AI in public radio newsletter", { limit: 5 });
    expect(d.bee.keywordSearch).toHaveBeenCalledWith("AI in public radio newsletter", { filter: "facts", limit: 5 });
    const clamped = clampedFirst();
    expect(d.chooseDraftFormat).toHaveBeenCalledWith({
      title: "AI in public radio newsletter", excerpts: [clamped, "maybe a radio segment too", "guests could be three station GMs"],
    });
    expect(d.writeOnePager).toHaveBeenCalledWith({
      title: "AI in public radio newsletter", format: "newsletter_pitch",
      timelineLines: ["Sep 12: first heard", "Oct 3: added a radio segment angle", "Oct 15: named three station GMs as guests"],
      excerpts: [`Sep 12: "${clamped}"`, 'Oct 3: "maybe a radio segment too"', 'Oct 15: "guests could be three station GMs"'],
      related: ["Earlier chat about AI tools at the station"],
      facts: ["Writes The Intersection newsletter"],
    });
    expect(out).toHaveLength(1);
    const { draft, format } = out[0]!;
    expect(format).toBe("newsletter_pitch");
    expect(draft.startsWith("Mentioned 3 times: Sep 12 · Oct 3 · Oct 15\n\n# AI at the station")).toBe(true);
    for (const m of draft.matchAll(/["“]([^"”]+)["”]/g)) expect(wordCount(m[1]!)).toBeLessThanOrEqual(25);
    expect(store.saveDraft).toHaveBeenCalledWith("txn", 12, draft, "newsletter_pitch");
    expect(tx.statements).toEqual(["save-statement"]);
    expect(store.releaseDraftClaim).not.toHaveBeenCalled();
  });

  it("still drafts when Bee search fails, logging ids and the error name only", async () => {
    store.claimDraftableClusters.mockResolvedValueOnce([12]);
    store.getClusterForDraft.mockResolvedValueOnce(cluster);
    const d = deps();
    d.bee.neuralSearch.mockRejectedValue(Object.assign(new Error("secret transcript words"), { name: "BeeApiError" }));
    d.bee.keywordSearch.mockRejectedValue(new Error("secret transcript words"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await draftBlooms({ deps: d as never });
    expect(out).toHaveLength(1);
    expect(d.writeOnePager).toHaveBeenCalledWith(expect.objectContaining({ related: [], facts: [] }));
    const logged = JSON.stringify(err.mock.calls);
    expect(logged).toContain("cluster=12");
    expect(logged).toContain("BeeApiError");
    expect(logged).not.toContain("secret");
    err.mockRestore();
  });

  it("does nothing (no model or Bee call) when nothing is claimable — already drafted, not ready, or claimed elsewhere", async () => {
    const d = deps();
    expect(await draftBlooms({ deps: d as never })).toEqual([]);
    expect(store.claimDraftableClusters).toHaveBeenCalledWith({ clusterIds: undefined, limit: 3 });
    expect(d.bee.neuralSearch).not.toHaveBeenCalled();
    expect(d.writeOnePager).not.toHaveBeenCalled();
    expect(store.saveDraft).not.toHaveBeenCalled();
  });

  it("a failed draft releases its claim (cluster stays bloomed without a draft) and the next cluster still drafts", async () => {
    store.claimDraftableClusters.mockResolvedValueOnce([12, 13]);
    store.getClusterForDraft.mockResolvedValueOnce(cluster).mockResolvedValueOnce({ ...cluster, id: 13 });
    const d = deps();
    d.writeOnePager.mockRejectedValueOnce(new DraftLengthError(120));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await draftBlooms({ deps: d as never });
    expect(store.releaseDraftClaim).toHaveBeenCalledWith(12);
    expect(out.map((o) => o.clusterId)).toEqual([13]);
    expect(JSON.stringify(err.mock.calls)).toMatch(/cluster=12.*DraftLengthError/);
    err.mockRestore();
  });

  it("a save that matched no row (the cluster left 'ready' meanwhile) returns no draft", async () => {
    store.claimDraftableClusters.mockResolvedValueOnce([12]);
    store.getClusterForDraft.mockResolvedValueOnce(cluster);
    tx.rows = [[]];
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await draftBlooms({ deps: deps() as never })).toEqual([]);
  });

  it("draftOnePagerForCluster claims only that cluster", async () => {
    store.claimDraftableClusters.mockResolvedValueOnce([12]);
    store.getClusterForDraft.mockResolvedValueOnce(cluster);
    const r = await draftOnePagerForCluster(12, deps() as never);
    expect(store.claimDraftableClusters).toHaveBeenCalledWith({ clusterIds: [12], limit: 1 });
    expect(r?.format).toBe("newsletter_pitch");
    store.claimDraftableClusters.mockResolvedValueOnce([]);
    expect(await draftOnePagerForCluster(12, deps() as never)).toBeNull();
  });
});

function clampedFirst(): string {
  return `a newsletter about AI in public radio ${words(30)}`.split(" ").slice(0, 25).join(" ");
}
