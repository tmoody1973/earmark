import { describe, expect, it, vi } from "vitest";

vi.mock("../../../agent/lib/env", () => ({ getEnv: () => ({ EMBED_MODEL: "openai/text-embedding-3-small" }) }));
import { EMBED_DIMENSIONS, embedText, toVectorLiteral } from "../../../agent/lib/ideas/embed";

describe("embedText", () => {
  it("returns the 1536-dim embedding from the configured model", async () => {
    const embedImpl = vi.fn(async () => ({ embedding: new Array(1536).fill(0.5) }));
    const v = await embedText("an idea", { embedImpl: embedImpl as never });
    expect(EMBED_DIMENSIONS).toBe(1536);
    expect(v).toHaveLength(1536);
    expect(embedImpl).toHaveBeenCalledWith({ model: "openai/text-embedding-3-small", value: "an idea" });
  });
  it("throws if the model returns the wrong dimension", async () => {
    const embedImpl = vi.fn(async () => ({ embedding: [1, 2, 3] }));
    await expect(embedText("x", { embedImpl: embedImpl as never })).rejects.toThrow(/1536/);
  });
});

describe("toVectorLiteral", () => {
  it("formats a pgvector literal", () => {
    expect(toVectorLiteral([0.1, -2, 3])).toBe("[0.1,-2,3]");
  });
});
