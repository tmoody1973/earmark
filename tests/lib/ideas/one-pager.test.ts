import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../agent/lib/env", () => ({
  getEnv: () => ({ TRIAGE_MODEL: "typesafe-ai/jev-1.13.0", WRITE_MODEL: "anthropic/claude-sonnet-5.5" }),
}));
const store = vi.hoisted(() => ({
  MAX_DRAFT_ATTEMPTS: 3,
  claimDraftableClusters: vi.fn(async (_o: { clusterIds?: number[]; limit: number }) => [] as Array<{ id: number; attempts: number; claim: string }>),
  getClusterForDraft: vi.fn(),
  releaseDraftClaim: vi.fn(async (_id: number) => {}),
  saveDraft: vi.fn((_txn: unknown, _id: number, _md: string, _f: string, _claim: string) => "save-statement"),
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
  BEE_SEARCH_TIMEOUT_MS, chooseDraftFormat, CONTEXT_MATCH_MIN, DRAFT_FORMAT_CRITERIA, DraftLengthError, draftBlooms,
  draftOnePagerForCluster, enforceQuoteLimit, factsFromKeyword, FACT_CRITERIA, gateContext, JEV_TIMEOUT_MS, mentionDatesLine,
  RELATED_CRITERIA, relatedFromNeural, WRITE_TIMEOUT_MS, writeOnePager,
} from "../../../agent/lib/ideas/one-pager";
import { ONE_PAGER_PROMPT } from "../../../agent/lib/ideas/one-pager-prompt";
import { wordCount } from "../../../agent/lib/pipeline/excerpt";

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
const claimed = (...ids: number[]) => ids.map((id) => ({ id, attempts: 1, claim: `claim-${id}` }));

beforeEach(() => {
  vi.clearAllMocks();
  tx.rows = [[{ id: 12 }]];
  tx.statements = [];
});

describe("timeouts fit inside the 60 s ingress (after ~5 s of live triage)", () => {
  it("Bee 6 s (parallel) + Jev 10 s + write 30 s", () => {
    expect([BEE_SEARCH_TIMEOUT_MS, JEV_TIMEOUT_MS, WRITE_TIMEOUT_MS]).toEqual([6_000, 10_000, 30_000]);
  });
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
  it("M2: leaves a line with unbalanced straight quotes alone (5\" screen), and matches curly quotes strictly", () => {
    // Old pairing took `" screen … with a "` as one 30-word "quote" and cut real prose.
    const inch = `A 5" screen ${words(30)} with a "dashboard".`;
    expect(enforceQuoteLimit(inch)).toBe(inch);
    // An opening curly quote is never closed by a straight one.
    const curly = `Mixed “${words(30)}" end.`;
    expect(enforceQuoteLimit(curly)).toBe(curly);
  });

  describe("M1: with excerpts, a quote must be a real excerpt", () => {
    const excerpts = ["I keep coming back to that public radio CRM, something that connects donors to the shows they listen to"];
    it("keeps the marks on a (normalised) substring of an excerpt", () => {
      const text = `He wanted “Something that connects donors to the shows they listen to.”`;
      expect(enforceQuoteLimit(text, 25, excerpts)).toBe(text);
    });
    it("drops the marks from an invented quote, keeping its words", () => {
      expect(enforceQuoteLimit('He said "we will raise a million dollars" twice.', 25, excerpts)).toBe("He said we will raise a million dollars twice.");
    });
    it("checks after clamping: a long real quote clamped to 25 words is still real", () => {
      const long = `public radio ${words(40)}`;
      const out = enforceQuoteLimit(`"${long}"`, 25, [long]);
      expect(out.startsWith('"public radio')).toBe(true);
      expect(wordCount(out)).toBe(25);
    });
    it("exempts the Headline options section until the next heading", () => {
      const text = '## Headline options\n- "Your donors, your shows"\n\n## Next\nHe said "invented line".';
      expect(enforceQuoteLimit(text, 25, excerpts)).toBe('## Headline options\n- "Your donors, your shows"\n\n## Next\nHe said invented line.');
    });
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
  it("asks Jev one Choice over the three formats with the idea and its excerpts as state (no dates), 10 s timeout", async () => {
    const decideImpl = vi.fn(async (_o: unknown) => ({ answers: { format: { type: "choice", choice: "radio_segment", probabilities: { radio_segment: 0.77 } } } }));
    const r = await chooseDraftFormat({ title: "Record store segment", excerpts: ["a weekly segment on record stores"] }, { decideImpl: decideImpl as never });
    expect(r).toEqual({ format: "radio_segment", probability: 0.77 });
    const call = (decideImpl.mock.calls[0] as unknown as [{ model: string; state: unknown; abortSignal: unknown; questions: { format: { criteria: object } } }])[0];
    expect(call.model).toBe("typesafe-ai/jev-1.13.0");
    expect(call.state).toEqual({ idea: "Record store segment", mentions: "- a weekly segment on record stores" });
    expect(call.abortSignal).toBeInstanceOf(AbortSignal);
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

// I-1: Bee search context reaches the writer only when Jev judges it the same idea (notes) or relevant (facts).
describe("gateContext", () => {
  const input = {
    title: "CRM for public radio stations", excerpts: ["a CRM for public radio stations"],
    related: ["Planned a CRM for public radio members", "Discussed a CRM for real-estate agents"],
    facts: ["Works at Radio Milwaukee", "Likes ramen"],
  };
  const answers = {
    rel_0: { type: "choice", choice: "same_idea", probabilities: { same_idea: 0.91, different_idea: 0.09 } },
    rel_1: { type: "choice", choice: "different_idea", probabilities: { same_idea: 0.12, different_idea: 0.88 } },
    fact_0: { type: "choice", choice: "relevant", probabilities: { relevant: 0.8, not_relevant: 0.2 } },
    fact_1: { type: "choice", choice: "not_relevant" }, // no distribution → never kept
  };

  it("asks one Choice per note and per fact in one Jev call and keeps only P ≥ CONTEXT_MATCH_MIN", async () => {
    const decideImpl = vi.fn(async (_o: unknown) => ({ answers }));
    const r = await gateContext(input, { decideImpl: decideImpl as never });
    expect(r.related).toEqual(["Planned a CRM for public radio members"]);
    expect(r.facts).toEqual(["Works at Radio Milwaukee"]);
    expect(r.probabilities).toEqual({ related: [0.91, 0.12], facts: [0.8, 0] });
    const call = (decideImpl.mock.calls[0] as unknown as [{ state: Record<string, unknown>; abortSignal: unknown; questions: Record<string, { criteria: object }> }])[0];
    expect(Object.keys(call.questions)).toEqual(["rel_0", "rel_1", "fact_0", "fact_1"]);
    // Excluding option first: Jev leans toward the first option, so ties lean toward leaving context out.
    expect(Object.keys(call.questions.rel_0!.criteria)).toEqual(["different_idea", "same_idea"]);
    expect(Object.keys(call.questions.fact_0!.criteria)).toEqual(["not_relevant", "relevant"]);
    expect(call.state).toMatchObject({ idea: input.title, rel_0: input.related[0], fact_1: input.facts[1] });
    expect(call.abortSignal).toBeInstanceOf(AbortSignal);
    expect(CONTEXT_MATCH_MIN).toBe(0.6);
  });

  it("criteria say a shared topic word is a different idea (real-estate CRM ≠ public radio CRM)", () => {
    expect(RELATED_CRITERIA.different_idea).toMatch(/real-estate agents is not a CRM for public radio/);
    expect(RELATED_CRITERIA.same_idea).toMatch(/same core proposal/);
    expect(FACT_CRITERIA.not_relevant).toMatch(/Do not choose|only shares/);
  });

  it("makes no Jev call when there is nothing to gate", async () => {
    const decideImpl = vi.fn();
    expect(await gateContext({ ...input, related: [], facts: [] }, { decideImpl: decideImpl as never }))
      .toEqual({ related: [], facts: [], probabilities: { related: [], facts: [] } });
    expect(decideImpl).not.toHaveBeenCalled();
  });
});

describe("writeOnePager", () => {
  const input = {
    title: "CRM for public radio", format: "product_brief" as const,
    timelineLines: ["Sep 12: first heard", "Oct 3: added donor tracking"], excerpts: ['Sep 12: "a CRM for public radio"'],
    related: ["Earlier chat about station tools"], facts: ["Works at Radio Milwaukee"],
  };

  it("writes with the WRITE model and the shared prompt, giving it every input, with a 30 s abort signal", async () => {
    const generateImpl = vi.fn(async (_o: unknown) => ({ text: `  ${words(400)}  ` }));
    expect(await writeOnePager(input, { generateImpl: generateImpl as never })).toBe(words(400));
    const call = (generateImpl.mock.calls[0] as unknown as [{ model: string; instructions: string; prompt: string; abortSignal: unknown }])[0];
    expect(call.model).toBe("anthropic/claude-sonnet-5.5");
    expect(call.instructions).toBe(ONE_PAGER_PROMPT);
    expect(call.abortSignal).toBeInstanceOf(AbortSignal);
    for (const s of ["product_brief", "CRM for public radio", "Sep 12: first heard", 'Sep 12: "a CRM for public radio"', "Earlier chat about station tools", "Works at Radio Milwaukee"]) {
      expect(call.prompt).toContain(s);
    }
  });

  it("a done research brief (decision 057) reaches the writer as citable context; none, no section", async () => {
    const generateImpl = vi.fn(async (_o: unknown) => ({ text: words(400) }));
    await writeOnePager({ ...input, research: "## What already exists\nMari exists [1].\n\n## Sources\n1. Mari — maricopa.gov" }, { generateImpl: generateImpl as never });
    const prompt = (generateImpl.mock.calls[0] as unknown as [{ prompt: string }])[0].prompt;
    expect(prompt).toContain("Research brief (from the web; a fact used from it names its source's site in parentheses; never quote it as said)");
    expect(prompt).toContain("Mari exists [1].");
    await writeOnePager(input, { generateImpl: generateImpl as never });
    expect((generateImpl.mock.calls[1] as unknown as [{ prompt: string }])[0].prompt).not.toContain("Research brief");
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
    expect(ONE_PAGER_PROMPT).toMatch(/only for what it says about this idea/);
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
      neuralSearch: vi.fn(async (_q: string, _o: unknown, _s?: AbortSignal) => ({ results: [{ id: 812, locations: [], short_summary: "Earlier chat about AI tools at the station", detailed_summary: "…" }] })),
      keywordSearch: vi.fn(async (_q: string, _o: unknown, _s?: AbortSignal) => ({ results: [{ id: "f_31", type: "fact", summary: "Writes The Intersection newsletter", snippet: null }] })),
    },
    gateContext: vi.fn(async (i: { related: string[]; facts: string[] }) => ({ related: i.related, facts: i.facts, probabilities: { related: [0.9], facts: [0.8] } })),
    chooseDraftFormat: vi.fn(async (_i: unknown) => ({ format: "newsletter_pitch" as const, probability: 0.8 })),
    writeOnePager: vi.fn(async (_i: unknown) => `# AI at the station\n\n## The pitch\nShe said "maybe a radio segment too" and "${words(30)}".`),
  });
  const ready = () => {
    store.claimDraftableClusters.mockResolvedValueOnce(claimed(12));
    store.getClusterForDraft.mockResolvedValueOnce(cluster);
  };

  it("claims, gathers sorted dated material plus gated Bee context, then saves draft + stage in one transaction", async () => {
    ready();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const d = deps();
    const out = await draftBlooms({ clusterIds: [12], deps: d as never });

    expect(store.claimDraftableClusters).toHaveBeenCalledWith({ clusterIds: [12], limit: 3 });
    expect(d.bee.neuralSearch).toHaveBeenCalledWith("AI in public radio newsletter", { limit: 5 }, expect.any(AbortSignal));
    expect(d.bee.keywordSearch).toHaveBeenCalledWith("AI in public radio newsletter", { filter: "facts", limit: 5 }, expect.any(AbortSignal));
    const clamped = clampedFirst();
    const excerpts = [clamped, "maybe a radio segment too", "guests could be three station GMs"];
    expect(d.gateContext).toHaveBeenCalledWith({
      title: "AI in public radio newsletter", excerpts,
      related: ["Earlier chat about AI tools at the station"], facts: ["Writes The Intersection newsletter"],
    });
    expect(d.chooseDraftFormat).toHaveBeenCalledWith({ title: "AI in public radio newsletter", excerpts });
    expect(d.writeOnePager).toHaveBeenCalledWith({
      title: "AI in public radio newsletter", format: "newsletter_pitch",
      timelineLines: ["Sep 12: first heard", "Oct 3: added a radio segment angle", "Oct 15: named three station GMs as guests"],
      excerpts: [`Sep 12: "${clamped}"`, 'Oct 3: "maybe a radio segment too"', 'Oct 15: "guests could be three station GMs"'],
      related: ["Earlier chat about AI tools at the station"],
      facts: ["Writes The Intersection newsletter"],
    });
    expect(out).toHaveLength(1);
    const { draft, format, probability } = out[0]!;
    expect([format, probability]).toEqual(["newsletter_pitch", 0.8]);
    expect(draft.startsWith("Mentioned 3 times: Sep 12 · Oct 3 · Oct 15\n\n# AI at the station")).toBe(true);
    // The real excerpt keeps its quote marks; the invented one loses them.
    expect(draft).toContain('She said "maybe a radio segment too" and w0 w1');
    expect(store.saveDraft).toHaveBeenCalledWith("txn", 12, draft, "newsletter_pitch", "claim-12");
    expect(tx.statements).toEqual(["save-statement"]);
    expect(store.releaseDraftClaim).not.toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).toContain("format=newsletter_pitch p=0.80");
    log.mockRestore();
  });

  it("passes the idea's done research brief to the writer (decision 057)", async () => {
    store.claimDraftableClusters.mockResolvedValueOnce(claimed(12));
    store.getClusterForDraft.mockResolvedValueOnce({ ...cluster, research: "## What already exists\nMari [1]." });
    vi.spyOn(console, "log").mockImplementation(() => {});
    const d = deps();
    await draftBlooms({ clusterIds: [12], deps: d as never });
    expect(d.writeOnePager).toHaveBeenCalledWith(expect.objectContaining({ research: "## What already exists\nMari [1]." }));
  });

  it("an off-topic note that Jev scores different_idea never reaches the writer", async () => {
    ready();
    vi.spyOn(console, "log").mockImplementation(() => {});
    const d = deps();
    d.bee.neuralSearch.mockResolvedValueOnce({ results: [
      { id: 1, locations: [], short_summary: "Newsletter plans on AI in public radio", detailed_summary: "" },
      { id: 2, locations: [], short_summary: "A CRM for real-estate agents", detailed_summary: "" },
    ] });
    const decideImpl = vi.fn(async () => ({ answers: {
      rel_0: { type: "choice", choice: "same_idea", probabilities: { same_idea: 0.9, different_idea: 0.1 } },
      rel_1: { type: "choice", choice: "different_idea", probabilities: { same_idea: 0.05, different_idea: 0.95 } },
      fact_0: { type: "choice", choice: "relevant", probabilities: { relevant: 0.7, not_relevant: 0.3 } },
    } }));
    const out = await draftBlooms({ deps: { ...d, gateContext: (i: Parameters<typeof gateContext>[0]) => gateContext(i, { decideImpl: decideImpl as never }) } as never });
    expect(out).toHaveLength(1);
    const sent = JSON.stringify(d.writeOnePager.mock.calls);
    expect(sent).toContain("Newsletter plans on AI in public radio");
    expect(sent).not.toContain("real-estate");
  });

  it("fails closed: if the gate (Jev) fails, no related notes or facts are sent and the draft still proceeds", async () => {
    ready();
    vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const d = deps();
    d.gateContext.mockRejectedValueOnce(Object.assign(new Error("secret words"), { name: "TimeoutError" }));
    const out = await draftBlooms({ deps: d as never });
    expect(out).toHaveLength(1);
    expect(d.writeOnePager).toHaveBeenCalledWith(expect.objectContaining({ related: [], facts: [] }));
    const logged = JSON.stringify(err.mock.calls);
    expect(logged).toContain("[draft] cluster=12 context gate failed error=TimeoutError");
    expect(logged).not.toContain("secret");
    err.mockRestore();
  });

  it("still drafts when Bee search fails, without calling the gate, logging ids and the error name only", async () => {
    ready();
    vi.spyOn(console, "log").mockImplementation(() => {});
    const d = deps();
    d.bee.neuralSearch.mockRejectedValue(Object.assign(new Error("secret transcript words"), { name: "BeeApiError" }));
    d.bee.keywordSearch.mockRejectedValue(new Error("secret transcript words"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await draftBlooms({ deps: d as never });
    expect(out).toHaveLength(1);
    expect(d.gateContext).not.toHaveBeenCalled();
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
    store.claimDraftableClusters.mockResolvedValueOnce(claimed(12, 13));
    store.getClusterForDraft.mockResolvedValueOnce(cluster).mockResolvedValueOnce({ ...cluster, id: 13 });
    vi.spyOn(console, "log").mockImplementation(() => {});
    const d = deps();
    d.writeOnePager.mockRejectedValueOnce(new DraftLengthError(120));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await draftBlooms({ deps: d as never });
    expect(store.releaseDraftClaim).toHaveBeenCalledWith(12);
    expect(out.map((o) => o.clusterId)).toEqual([13]);
    expect(JSON.stringify(err.mock.calls)).toMatch(/cluster=12 failed error=DraftLengthError/);
    err.mockRestore();
  });

  it("I-2: a writer timeout logs the timeout's name and releases the claim", async () => {
    ready();
    const d = deps();
    d.writeOnePager.mockRejectedValueOnce(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await draftBlooms({ deps: d as never })).toEqual([]);
    expect(store.releaseDraftClaim).toHaveBeenCalledWith(12);
    expect(JSON.stringify(err.mock.calls)).toContain("[draft] cluster=12 failed error=TimeoutError");
    err.mockRestore();
  });

  it("M3: the last allowed attempt failing logs a distinct give-up line", async () => {
    store.claimDraftableClusters.mockResolvedValueOnce([{ id: 12, attempts: 3, claim: "claim-12" }]);
    store.getClusterForDraft.mockResolvedValueOnce(cluster);
    const d = deps();
    d.chooseDraftFormat.mockRejectedValueOnce(Object.assign(new Error("x"), { name: "AI_APICallError" }));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await draftBlooms({ deps: d as never });
    expect(JSON.stringify(err.mock.calls)).toContain("[draft] cluster=12 gave up after 3 attempts error=AI_APICallError");
    err.mockRestore();
  });

  it("a save that matched no row (the cluster left 'ready' meanwhile) returns no draft", async () => {
    ready();
    tx.rows = [[]];
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await draftBlooms({ deps: deps() as never })).toEqual([]);
  });

  it("draftOnePagerForCluster claims only that cluster", async () => {
    ready();
    vi.spyOn(console, "log").mockImplementation(() => {});
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
