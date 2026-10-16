import { describe, expect, it, vi } from "vitest";
import type { generateText } from "ai";
import { extractIdea, extractRecommendation } from "../../../agent/lib/pipeline/extract";
import { wordCount } from "../../../agent/lib/pipeline/excerpt";

const fake = (output: unknown) => vi.fn(async () => ({ output })) as unknown as typeof generateText;
const text = "Unknown: Ann says you have to try the tonkotsu at Ardent\nUnknown: the broth is the reason to go";

describe("extractRecommendation", () => {
  it("keeps a recommender name that appears in the text", async () => {
    const r = await extractRecommendation({ text, summary: null }, {
      model: "m",
      generateImpl: fake({ canonicalName: " Ardent ", creator: null, recommenderName: "Ann", excerpt: "you have to try the tonkotsu at Ardent" }),
    });
    expect(r).toEqual({ canonicalName: "Ardent", creator: null, recommenderName: "Ann", excerpt: "you have to try the tonkotsu at Ardent" });
  });

  it("drops a recommender name that is in neither the text nor the summary", async () => {
    const r = await extractRecommendation({ text, summary: "Lunch with a coworker." }, {
      model: "m",
      generateImpl: fake({ canonicalName: "Ardent", creator: null, recommenderName: "Bob", excerpt: "the broth is the reason to go" }),
    });
    expect(r.recommenderName).toBeNull();
  });

  it("accepts a name that only appears in Bee's summary", async () => {
    const r = await extractRecommendation({ text: "Unknown: you have to try Ardent", summary: "Marcus recommended Ardent." }, {
      model: "m",
      generateImpl: fake({ canonicalName: "Ardent", creator: null, recommenderName: "Marcus", excerpt: "you have to try Ardent" }),
    });
    expect(r.recommenderName).toBe("Marcus");
  });

  it("replaces a non-verbatim excerpt with the start of the window, clamped to 25 words", async () => {
    const longText = `Unknown: ${Array.from({ length: 40 }, (_, i) => `w${i}`).join(" ")}`;
    const r = await extractRecommendation({ text: longText, summary: null }, {
      model: "m",
      generateImpl: fake({ canonicalName: "X", creator: null, recommenderName: null, excerpt: "a paraphrase that was never said" }),
    });
    expect(r.excerpt.startsWith("w0 w1")).toBe(true);
    expect(wordCount(r.excerpt)).toBeLessThanOrEqual(25);
  });

  it("clamps an over-long verbatim excerpt and survives quotes, emoji and non-English text", async () => {
    const body = `"vamos" 🍜 ${Array.from({ length: 35 }, (_, i) => `café${i}`).join(" ")}`;
    const r = await extractRecommendation({ text: `Unknown: ${body}\nUnknown: ok`, summary: null }, {
      model: "m",
      generateImpl: fake({ canonicalName: "X", creator: null, recommenderName: null, excerpt: body }),
    });
    expect(wordCount(r.excerpt)).toBe(25);
    expect(r.excerpt.startsWith('"vamos" 🍜 café0')).toBe(true);
  });

  it("passes the model and instructions, never `system`", async () => {
    const gen = fake({ canonicalName: "Ardent", creator: null, recommenderName: null, excerpt: "the broth is the reason to go" });
    await extractRecommendation({ text, summary: null }, { model: "anthropic/claude-haiku-5.5", generateImpl: gen });
    const args = (gen as unknown as { mock: { calls: Array<[Record<string, unknown>]> } }).mock.calls[0]![0];
    expect(args.model).toBe("anthropic/claude-haiku-5.5");
    expect(typeof args.instructions).toBe("string");
    expect(args).not.toHaveProperty("system");
  });
});

describe("extractIdea", () => {
  it("returns a trimmed title and a verbatim, clamped excerpt", async () => {
    const t = "Unknown: what if we did a Rhythm Lab segment on Milwaukee house history";
    const r = await extractIdea(t, { model: "m", generateImpl: fake({ title: " Milwaukee house history segment ", excerpt: "what if we did a Rhythm Lab segment on Milwaukee house history" }) });
    expect(r).toEqual({ title: "Milwaukee house history segment", excerpt: "what if we did a Rhythm Lab segment on Milwaukee house history" });
  });
});

describe("model-written fields are bounded", () => {
  const words = (n: number) => Array.from({ length: n }, (_, i) => `Word${i}`).join(" ");

  it("schemas reject an over-long title, canonicalName (> 120 chars) or creator (> 80 chars)", async () => {
    const { IdeaSchema, RecSchema } = await import("../../../agent/lib/pipeline/extract");
    const rec = { canonicalName: "Ardent", creator: null, recommenderName: null, excerpt: "x" };
    expect(RecSchema.safeParse(rec).success).toBe(true);
    expect(RecSchema.safeParse({ ...rec, canonicalName: "a".repeat(121) }).success).toBe(false);
    expect(RecSchema.safeParse({ ...rec, creator: "a".repeat(81) }).success).toBe(false);
    expect(IdeaSchema.safeParse({ title: "a".repeat(121), excerpt: "x" }).success).toBe(false);
  });

  it("clamps canonicalName and title to 12 words in code", async () => {
    const r = await extractRecommendation({ text, summary: null }, {
      model: "m",
      generateImpl: fake({ canonicalName: words(20), creator: null, recommenderName: null, excerpt: "you have to try the tonkotsu at Ardent" }),
    });
    expect(r.canonicalName).toBe(words(12));
    const i = await extractIdea(text, { model: "m", generateImpl: fake({ title: words(20), excerpt: "the broth is the reason to go" }) });
    expect(i.title).toBe(words(12));
  });
});
