import { describe, expect, it, vi } from "vitest";
import type { generateText } from "ai";
import { extractIdea, extractRecommendation } from "../../../agent/lib/pipeline/extract";

const fake = (output: unknown) => vi.fn(async () => ({ output })) as unknown as typeof generateText;
const rec = (o: Record<string, unknown>) => ({ canonicalName: "X", creator: null, recommenderName: null, excerpt: "", ...o });

describe("label stripping", () => {
  it("strips labels everywhere, including mid-line", async () => {
    const r = await extractIdea("Unknown: a Unknown: b", { model: "m", generateImpl: fake({ title: "t", excerpt: "nothing like it" }) });
    expect(r.excerpt).toBe("a b");
    expect(r.excerpt).not.toContain("Unknown:");
  });
  it("keeps non-label prefixes like Note:", async () => {
    const r = await extractIdea("Unknown: Note: try it", { model: "m", generateImpl: fake({ title: "t", excerpt: "Note: try it" }) });
    expect(r.excerpt).toBe("Note: try it");
    const r2 = await extractIdea("Unknown: I said: wow", { model: "m", generateImpl: fake({ title: "t", excerpt: "" }) });
    expect(r2.excerpt).toBe("I said: wow");
  });
  it("never stores a label from the model's candidate", async () => {
    const r = await extractIdea("Unknown: try the ramen", { model: "m", generateImpl: fake({ title: "t", excerpt: "Unknown: try the ramen" }) });
    expect(r.excerpt).toBe("try the ramen");
  });
});

describe("recommender name validation", () => {
  const text = "Unknown: Ann Smith says you have to try Ardent";
  it("rejects label names and reduces to first name", async () => {
    const g = (n: string) => ({ model: "m", generateImpl: fake(rec({ recommenderName: n })) });
    expect((await extractRecommendation({ text, summary: null }, g("Unknown"))).recommenderName).toBeNull();
    expect((await extractRecommendation({ text, summary: null }, g("You"))).recommenderName).toBeNull();
    expect((await extractRecommendation({ text, summary: null }, g("Ann Smith"))).recommenderName).toBe("Ann");
  });
});

describe("verbatim spans", () => {
  it("does not match inside a longer word and falls back", async () => {
    const r = await extractRecommendation({ text: "Unknown: a nice place", summary: null }, { model: "m", generateImpl: fake(rec({ excerpt: "ice" })) });
    expect(r.excerpt).toBe("a nice place");
  });
  it("returns the source's casing", async () => {
    const r = await extractRecommendation({ text: "Unknown: Try The Ramen", summary: null }, { model: "m", generateImpl: fake(rec({ excerpt: "try the ramen" })) });
    expect(r.excerpt).toBe("Try The Ramen");
  });
  it("falls back to the line containing the canonical name", async () => {
    const text = "Unknown: lunch was fine\nUnknown: you have to try Ardent. Great broth";
    const r = await extractRecommendation({ text, summary: null }, { model: "m", generateImpl: fake(rec({ canonicalName: "ardent", excerpt: "made up" })) });
    expect(r.excerpt).toBe("you have to try Ardent");
  });
});

describe("robustness", () => {
  it("trims names and uses the fallback for an empty excerpt", async () => {
    const r = await extractRecommendation({ text: "Unknown: try it", summary: null }, { model: "m", generateImpl: fake(rec({ canonicalName: "  X ", excerpt: "   " })) });
    expect(r.canonicalName).toBe("X");
    expect(r.excerpt).toBe("try it");
  });
  it("propagates generation errors", async () => {
    const gen = vi.fn(async () => { throw new Error("NoObjectGeneratedError"); }) as unknown as typeof generateText;
    await expect(extractRecommendation({ text: "Unknown: x", summary: null }, { model: "m", generateImpl: gen })).rejects.toThrow("NoObjectGeneratedError");
    await expect(extractIdea("Unknown: x", { model: "m", generateImpl: gen })).rejects.toThrow("NoObjectGeneratedError");
  });
  it("wraps the transcript in delimiters and marks it untrusted", async () => {
    const gen = fake(rec({ excerpt: "hi" }));
    await extractRecommendation({ text: "Unknown: hi", summary: null }, { model: "m", generateImpl: gen });
    const args = (gen as unknown as { mock: { calls: Array<[{ prompt: string; instructions: string }]> } }).mock.calls[0]![0];
    expect(args.prompt).toContain("<transcript>");
    expect(args.prompt).toContain("</transcript>");
    expect(args.instructions).toMatch(/untrusted/i);
  });
});
