import { afterEach, describe, expect, it, vi } from "vitest";
import { conversationSummary, SUMMARY_INSTRUCTIONS, writeContextSummary, type SummaryInput } from "../../../agent/lib/recs/summary";

type GenArgs = { prompt: string; abortSignal?: AbortSignal };
const gen = (why: string | null) => vi.fn<(args: GenArgs) => Promise<{ output: { why: string | null } }>>(async () => ({ output: { why } }));
const input: SummaryInput = { name: "Ramen-Ya", excerpt: "the broth is the reason to go", beeSummary: null, recommender: "Ann" };
const write = (g: ReturnType<typeof gen>, over: Partial<SummaryInput> = {}) =>
  writeContextSummary({ ...input, ...over }, { generateImpl: g as never, model: "m" });

afterEach(() => vi.unstubAllEnvs());

describe("writeContextSummary", () => {
  it("returns the model's line clamped to 25 words", async () => {
    const long = Array.from({ length: 40 }, (_, i) => `w${i}`).join(" ");
    expect((await write(gen(long)))!.split(/\s+/)).toHaveLength(25);
  });

  it("puts the excerpt, recommender and Bee summary in the prompt, and bounds the call", async () => {
    const g = gen("The broth is the reason to go.");
    await write(g, { beeSummary: "Lunch with Ann about Milwaukee food" });
    const args = g.mock.calls[0]![0];
    expect(args.prompt).toContain("the broth is the reason to go");
    expect(args.prompt).toContain("Ann");
    expect(args.prompt).toContain("Lunch with Ann");
    expect(args.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it("no reason given → null, never filler", async () => {
    expect(await write(gen(null))).toBeNull();
    expect(await write(gen("   "))).toBeNull();
  });

  it("drops the card's own quote marks (the card adds them)", async () => {
    expect(await write(gen("“The broth is the reason to go.”"))).toBe("The broth is the reason to go.");
  });

  it("a line that names the owner is not stored", async () => {
    vi.stubEnv("EARMARK_OWNER_FIRST_NAME", "Tarik");
    expect(await write(gen("Ann told Tarik the broth is the reason to go."))).toBeNull();
    expect(await write(gen("Ann says the broth is the reason to go."))).toBe("Ann says the broth is the reason to go.");
  });

  it("never offers the owner as the recommender, and says who never to name", async () => {
    vi.stubEnv("EARMARK_OWNER_FIRST_NAME", "Tarik Moody");
    const g = gen("x");
    await write(g, { recommender: "tarik" });
    expect(g.mock.calls[0]![0].prompt).toContain("<recommender>unknown</recommender>");
    expect(SUMMARY_INSTRUCTIONS).toMatch(/first names only/i);
  });

  it("names the recommender by first name, or no one when unknown; never 'the speaker'", () => {
    expect(SUMMARY_INSTRUCTIONS).toMatch(/recommender by the first name given/i);
    expect(SUMMARY_INSTRUCTIONS).toMatch(/unknown, write the line without naming anyone/i);
    expect(SUMMARY_INSTRUCTIONS).toMatch(/never write "the speaker" or "someone"/i);
    expect(SUMMARY_INSTRUCTIONS.replace(/never write "the speaker" or "someone"/i, "")).not.toMatch(/the speaker|someone/i);
  });

  it("the owner becomes 'you' in the excerpt and Bee summary, so the why is not lost to the output guard", async () => {
    vi.stubEnv("EARMARK_OWNER_FIRST_NAME", "Tarik Moody");
    const g = gen("x");
    const excerpt = "tarik you should try it, Tarik's kind of place, " + Array.from({ length: 30 }, () => "w").join(" ");
    await write(g, { excerpt, beeSummary: "Ann told Tarik about Ramen-Ya at lunch." });
    const prompt = g.mock.calls[0]![0].prompt;
    expect(prompt).not.toMatch(/tarik/i);
    expect(prompt).toContain("you you should try it, your kind of place");
    expect(prompt).toContain("Ann told you about Ramen-Ya");
    const ex = prompt.split("<excerpt>\n")[1]!.split("\n</excerpt>")[0]!;
    expect(ex.split(/\s+/).length).toBeLessThanOrEqual(25);
  });

  it("bounds a long Bee summary before it reaches the model", async () => {
    const g = gen("x");
    await write(g, { beeSummary: Array.from({ length: 500 }, () => "word").join(" ") });
    expect(g.mock.calls[0]![0].prompt.split(/\s+/).filter((w) => w === "word").length).toBeLessThanOrEqual(150);
  });
});

describe("conversationSummary", () => {
  it("reads short_summary or summary from either response shape", () => {
    expect(conversationSummary({ conversation: { short_summary: "A", summary: "B" } })).toBe("A");
    expect(conversationSummary({ summary: "B" })).toBe("B");
    expect(conversationSummary({ conversation: { short_summary: null, summary: null } })).toBeNull();
    expect(conversationSummary(null)).toBeNull();
  });
});
