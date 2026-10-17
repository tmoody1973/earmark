import { describe, expect, it, vi } from "vitest";

vi.mock("../../../agent/lib/env", () => ({ getEnv: () => ({ EXTRACT_MODEL: "anthropic/claude-haiku-5.5" }) }));
import { formatTimelineDate, timelineLine, writeTimelineNote } from "../../../agent/lib/ideas/timeline";

describe("Chicago date edges", () => {
  it("CST (winter): 05:30Z on Nov 10 is still Nov 9", () => {
    expect(formatTimelineDate(new Date("2026-11-10T05:30:00Z"))).toBe("Nov 9");
    expect(timelineLine(new Date("2026-11-10T05:30:00Z"), "x")).toBe("Nov 9: x");
  });
  it("an empty note still yields a dated line, without throwing", () => {
    expect(timelineLine(new Date("2026-10-03T15:00:00Z"), "   ")).toBe("Oct 3: ");
  });
});

describe("writeTimelineNote hardening", () => {
  const gen = (note: string) => vi.fn(async (_o: Record<string, unknown>) => ({ output: { note } }));
  const run = (g: ReturnType<typeof gen>, over: Partial<{ clusterTitle: string; excerpt: string }> = {}) =>
    writeTimelineNote({ clusterTitle: "t", priorLines: [], excerpt: "x", ...over }, { generateImpl: g as never });

  it.each([
    ["October 5 - added a guest"],
    ["Oct 5, added a guest"],
    ["Oct 5th: added a guest"],
    ["Sept. 5 – added a guest"],
    ["Oct 5: Oct 6: added a guest"],
  ])("strips the leading date from %j", async (raw) => {
    expect(await run(gen(raw))).toBe("added a guest");
  });

  it.each([["Studio 54, played the set"], ["Route 66 – a road-trip show"], ["Apollo 11: moon landing special"]])(
    "leaves a non-date start alone: %j", async (raw) => {
      expect(await run(gen(raw))).toBe(raw);
    },
  );

  it("escapes double quotes in the title and excerpt inside the prompt", async () => {
    const g = gen("added a guest");
    await run(g, { clusterTitle: 'The "big" idea', excerpt: 'she said "go"' });
    const prompt = String(g.mock.calls[0]![0].prompt);
    expect(prompt).toContain(`"The 'big' idea"`);
    expect(prompt).toContain(`"she said 'go'"`);
  });

  it("asks to keep names and proper nouns capitalised, with a worked example", async () => {
    const g = gen("added a guest");
    await run(g);
    const prompt = String(g.mock.calls[0]![0].prompt);
    expect(prompt).toContain("keep names and proper nouns capitalised");
    expect(prompt).toMatch(/e\.g\.[^\n]*[A-Z][a-z]+ /);
  });
});
