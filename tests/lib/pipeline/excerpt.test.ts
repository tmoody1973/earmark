import { describe, expect, it } from "vitest";
import { clampExcerpt, wordCount } from "../../../agent/lib/pipeline/excerpt";

describe("excerpt", () => {
  it("counts words the same way the database check does (split on whitespace after trim)", () => {
    expect(wordCount("  one two\nthree\tfour ")).toBe(4);
    expect(wordCount("")).toBe(0);
  });

  it("leaves short text unchanged apart from whitespace", () => {
    expect(clampExcerpt("  you have to\n try it  ")).toBe("you have to try it");
  });

  it("cuts to 25 words without adding an ellipsis word", () => {
    const long = Array.from({ length: 40 }, (_, i) => `w${i}`).join(" ");
    const out = clampExcerpt(long);
    expect(wordCount(out)).toBe(25);
    expect(out.endsWith("w24")).toBe(true);
  });

  it("keeps quotes and emoji", () => {
    expect(clampExcerpt('she said "go" 🍜')).toBe('she said "go" 🍜');
  });

  it("honors a custom limit", () => {
    expect(clampExcerpt("a b c d", 2)).toBe("a b");
  });

  it("clamps text with quotes, newlines, emoji and non-English words without breaking them", () => {
    const words = Array.from({ length: 30 }, (_, i) => (i % 3 === 0 ? `"q${i}"` : i % 3 === 1 ? "🍜" : "café"));
    const messy = words.map((w, i) => (i % 5 === 0 ? `${w}\n` : w)).join(" ");
    const out = clampExcerpt(messy);
    expect(wordCount(out)).toBe(25);
    expect(out).toContain("🍜");
    expect(out).toContain("café");
    expect(out).toContain('"q0"');
    expect(out).not.toContain("\n");
    expect(clampExcerpt("日本語 の ラーメン 屋")).toBe("日本語 の ラーメン 屋");
  });
});
