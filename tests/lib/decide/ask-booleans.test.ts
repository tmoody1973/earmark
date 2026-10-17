import { describe, expect, it, vi } from "vitest";

vi.mock("../../../agent/lib/env", () => ({ getEnv: () => ({ TRIAGE_MODEL: "typesafe-ai/jev-1.13.0" }) }));
import { askBooleans } from "../../../agent/lib/decide/ask-booleans";

describe("askBooleans", () => {
  it("sends boolean questions with true/false criteria in one call and returns P(true) per key", async () => {
    const decideImpl = vi.fn(async () => ({
      answers: { q_a: { type: "boolean", probability: 0.9 }, q_b: { type: "boolean", probability: 0.1 } },
    }));
    const out = await askBooleans(
      { item: "a synthetic item" },
      {
        q_a: { instructions: "A?", whenTrue: "yes case", whenFalse: "no case" },
        q_b: { instructions: "B?", whenTrue: "yes", whenFalse: "no" },
      },
      { decideImpl: decideImpl as never },
    );
    expect(out).toEqual({ q_a: 0.9, q_b: 0.1 });
    expect(decideImpl).toHaveBeenCalledTimes(1);
    const call = (decideImpl.mock.calls[0] as unknown[])[0] as { model: string; state: unknown; questions: Record<string, unknown> };
    expect(call.model).toBe("typesafe-ai/jev-1.13.0");
    expect(call.state).toEqual({ item: "a synthetic item" });
    expect(call.questions.q_a).toEqual({ type: "boolean", instructions: "A?", criteria: { true: "yes case", false: "no case" } });
  });

  it("bounds every call with a timeout, so a hung call cannot hold the hourly run", async () => {
    const decideImpl = vi.fn(async () => ({ answers: { q_a: { type: "boolean", probability: 0.5 } } }));
    await askBooleans({ x: "y" }, { q_a: { instructions: "?", whenTrue: "t", whenFalse: "f" } }, { decideImpl: decideImpl as never });
    const call = (decideImpl.mock.calls[0] as unknown[])[0] as { abortSignal?: AbortSignal };
    expect(call.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it("rejects integer-like keys (JS would reorder them)", async () => {
    await expect(askBooleans({ x: "y" }, { "12": { instructions: "?", whenTrue: "t", whenFalse: "f" } })).rejects.toThrow(/non-numeric/);
  });

  it("throws when an answer is missing or not a finite probability, so a broken reply is never stored as a link", async () => {
    const decideImpl = vi.fn(async () => ({ answers: { q_a: { type: "boolean", probability: Number.NaN } } }));
    await expect(
      askBooleans({ x: "y" }, { q_a: { instructions: "?", whenTrue: "t", whenFalse: "f" } }, { decideImpl: decideImpl as never }),
    ).rejects.toThrow(/q_a/);
  });
});
