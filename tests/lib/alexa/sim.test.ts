import { describe, expect, it, vi } from "vitest";
import { FALLBACK, SimInput, runTurn, type SimDeps } from "../../../agent/lib/alexa/sim";

const base = { question: "What did Ann tell me to try?", history: [], origin: "https://earmark.test" };
const fakeDeps = (over: Partial<SimDeps> = {}): SimDeps & { close: ReturnType<typeof vi.fn> } => {
  const close = vi.fn(async () => {});
  return {
    close,
    mint: vi.fn(async () => "TOKEN"),
    connect: vi.fn(async () => ({ tools: async () => ({}), close })),
    generate: vi.fn(async () => ({ text: "Ann liked Ramen Lab.", steps: [{ toolCalls: [{ toolName: "search_earmarks" }] }, { toolCalls: [{ toolName: "search_earmarks" }, { toolName: "ready_ideas" }] }] })) as never,
    synthesize: vi.fn(async () => Uint8Array.from([1, 2, 3])),
    model: "test/model",
    ...over,
  };
};

describe("SimInput", () => {
  it("caps the question at 300 chars, history at 6 turns of 600 chars", () => {
    expect(SimInput.safeParse({ question: "x".repeat(301), history: [] }).success).toBe(false);
    expect(SimInput.safeParse({ question: "", history: [] }).success).toBe(false);
    const turn = { role: "user", text: "hi" };
    expect(SimInput.safeParse({ question: "ok", history: Array(7).fill(turn) }).success).toBe(false);
    expect(SimInput.safeParse({ question: "ok", history: [{ role: "user", text: "x".repeat(601) }] }).success).toBe(false);
    expect(SimInput.safeParse({ question: "ok", history: Array(6).fill(turn) }).success).toBe(true);
  });
});

describe("runTurn", () => {
  it("mints a token, connects to the MCP url with it, and returns answer, unique tools, base64 audio", async () => {
    const d = fakeDeps();
    const out = await runTurn(base, d);
    expect(d.connect).toHaveBeenCalledWith("https://earmark.test/api/mcp", "TOKEN");
    expect(out).toEqual({ answer: "Ann liked Ramen Lab.", toolsUsed: ["search_earmarks", "ready_ideas"], audio: Buffer.from([1, 2, 3]).toString("base64") });
    expect(d.close).toHaveBeenCalledOnce();
  });
  it("passes history as prior messages and a persona", async () => {
    const d = fakeDeps();
    await runTurn({ ...base, history: [{ role: "user", text: "hi" }, { role: "assistant", text: "hello" }] }, d);
    const arg = (d.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(arg.instructions).toMatch(/first names/i);
  });
  it("returns text only when Polly fails", async () => {
    const out = await runTurn(base, fakeDeps({ synthesize: vi.fn(async () => { throw new Error("secret detail"); }) }));
    expect(out.answer).toBe("Ann liked Ramen Lab.");
    expect(out.audio).toBeUndefined();
  });
  it("caps the text sent to Polly", async () => {
    const d = fakeDeps({ generate: vi.fn(async () => ({ text: "word ".repeat(400), steps: [] })) as never });
    await runTurn(base, d);
    const chunks = (d.synthesize as ReturnType<typeof vi.fn>).mock.calls[0][0] as string[];
    expect(chunks.join(" ").length).toBeLessThanOrEqual(600);
  });
  it("falls back politely, closes the client, and logs only the error name", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const d = fakeDeps({ generate: vi.fn(async () => { throw new TypeError("Ann token leak"); }) as never });
    const out = await runTurn(base, d);
    expect(out).toEqual({ answer: FALLBACK, toolsUsed: [] });
    expect(d.close).toHaveBeenCalledOnce();
    expect(JSON.stringify(err.mock.calls)).toContain("TypeError");
    expect(JSON.stringify(err.mock.calls)).not.toMatch(/Ann|token leak|TOKEN/);
    err.mockRestore();
  });
  it("falls back when the token cannot be minted", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await runTurn(base, fakeDeps({ mint: vi.fn(async () => { throw new Error("not_configured"); }) }));
    expect(out.answer).toBe(FALLBACK);
    err.mockRestore();
  });
  it("falls back on an empty answer", async () => {
    const out = await runTurn(base, fakeDeps({ generate: vi.fn(async () => ({ text: "  ", steps: [] })) as never }));
    expect(out.answer).toBe(FALLBACK);
  });
});
