import { describe, expect, it, vi } from "vitest";
import { chunkForPolly, synthesize } from "../../../agent/lib/episode/voice";

describe("chunkForPolly", () => {
  it("keeps chunks under the limit and never splits mid-sentence when it can avoid it", () => {
    const para = "One sentence here. ".repeat(100).trim(); // ~1900 chars
    const chunks = chunkForPolly(`${para}\n\n${para}\n\n${para}`, 2900);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(2900);
      expect(c.endsWith(".")).toBe(true);
    }
    expect(chunks.join(" ").replace(/\s+/g, " ")).toBe(`${para} ${para} ${para}`.replace(/\s+/g, " "));
  });
  it("hard-splits a single run-on sentence longer than the limit", () => {
    const chunks = chunkForPolly("a".repeat(7000), 2900);
    expect(chunks.map((c) => c.length)).toEqual([2900, 2900, 1200]);
  });
});

describe("synthesize", () => {
  it("calls Polly once per chunk with the generative engine and concatenates the MP3 bytes", async () => {
    const send = vi.fn(async (cmd: { input: Record<string, string> }) => {
      expect(cmd.input).toMatchObject({ Engine: "generative", OutputFormat: "mp3", VoiceId: "Ruth", TextType: "text" });
      return { AudioStream: { transformToByteArray: async () => new Uint8Array([1, 2]) } };
    });
    const out = await synthesize(["a", "b"], { send } as never, "Ruth");
    expect(Array.from(out)).toEqual([1, 2, 1, 2]);
    expect(send).toHaveBeenCalledTimes(2);
  });
  it("fails when Polly returns no audio", async () => {
    await expect(synthesize(["a"], { send: async () => ({}) } as never, "Ruth")).rejects.toThrow(/no audio/);
  });
});
