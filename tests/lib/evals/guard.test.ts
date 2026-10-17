import { describe, expect, it } from "vitest";
import { parseJsonl } from "../../../agent/lib/evals/labels";
import { costPlan, shouldAbortWrite } from "../../../agent/lib/evals/guard";

describe("costPlan", () => {
  it("n × models × orders calls, priced per model by average input tokens", () => {
    // 10 snippets × 2 models × 3 orders = 60 calls; 1000 tok avg → 30k tok per model...
    const p = costPlan({ n: 10, models: ["typesafe-ai/jev-1.13.0", "openai/gpt-6-luna-decisions"], orders: 3, avgInputTokens: 1000 });
    expect(p.calls).toBe(60);
    // jev: 30 calls × 1000 tok × 0.042/M = 0.00126 ; openai: 30 × 1000 × 0.1/M = 0.003
    expect(p.estUsd).toBeCloseTo(0.00426, 8);
    expect(p.summary).toBe("10 × 2 models × 3 orders = 60 calls, est. $0.0043");
  });
});

describe("shouldAbortWrite", () => {
  it("aborts when nothing succeeded", () => expect(shouldAbortWrite(0, 5)).toMatch(/no snippets/));
  it("aborts when errors exceed 10% of attempts", () => expect(shouldAbortWrite(8, 2)).toMatch(/20%/));
  it("allows exactly 10%", () => expect(shouldAbortWrite(9, 1)).toBeNull());
});

describe("parseJsonl errors", () => {
  it("names the line number but not the content", () => {
    let msg = "";
    try { parseJsonl('{"a":1}\nSECRET-WINDOW-TEXT\n{"a":2}\n'); } catch (e) { msg = (e as Error).message; }
    expect(msg).toContain("line 2");
    expect(msg).not.toContain("SECRET");
  });
});
