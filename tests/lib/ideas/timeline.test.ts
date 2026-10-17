import { describe, expect, it, vi } from "vitest";

vi.mock("../../../agent/lib/env", () => ({ getEnv: () => ({ EXTRACT_MODEL: "anthropic/claude-haiku-5.5" }) }));
import { formatTimelineDate, timelineEntryJson, timelineLine, writeTimelineNote } from "../../../agent/lib/ideas/timeline";
import { wordCount } from "../../../agent/lib/pipeline/excerpt";

describe("formatTimelineDate", () => {
  it("formats in Tarik's time zone (America/Chicago)", () => {
    expect(formatTimelineDate(new Date("2026-10-03T15:00:00Z"))).toBe("Oct 3");
    expect(formatTimelineDate(new Date("2026-10-03T03:00:00Z"))).toBe("Oct 2"); // 10 pm CDT on Oct 2
  });
});

describe("timelineLine", () => {
  it("prefixes the code-formatted date and caps the note at 12 words", () => {
    const line = timelineLine(new Date("2026-10-15T15:00:00Z"), "named three possible guests for the segment and also a sponsor and a venue too");
    expect(line.startsWith("Oct 15: ")).toBe(true);
    expect(wordCount(line.slice("Oct 15: ".length))).toBeLessThanOrEqual(12);
  });
});

describe("timelineEntryJson", () => {
  it("is a one-element array of {ISO date of the mention, code-dated line}", () => {
    const d = new Date("2026-10-03T15:00:00Z");
    expect(JSON.parse(timelineEntryJson(d, "first heard"))).toEqual([{ date: "2026-10-03T15:00:00.000Z", line: "Oct 3: first heard" }]);
  });
});

describe("writeTimelineNote", () => {
  it("asks the extraction model for a structured note and strips any date the model added", async () => {
    const generateImpl = vi.fn(async () => ({ output: { note: "Oct 5: added a radio segment angle" } }));
    const note = await writeTimelineNote(
      { clusterTitle: "AI newsletter", priorLines: ["Sep 12: newsletter angle"], excerpt: "maybe this is also a radio segment" },
      { generateImpl: generateImpl as never },
    );
    expect(note).toBe("added a radio segment angle");
    const call = (generateImpl.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(call.model).toBe("anthropic/claude-haiku-5.5");
    expect(String(call.prompt)).toContain("Sep 12: newsletter angle");
  });

  it("clamps an over-long note to 12 words and rejects an empty one", async () => {
    const long = vi.fn(async () => ({ output: { note: "one two three four five six seven eight nine ten eleven twelve thirteen fourteen" } }));
    const note = await writeTimelineNote({ clusterTitle: "t", priorLines: [], excerpt: "x" }, { generateImpl: long as never });
    expect(wordCount(note)).toBe(12);
    const empty = vi.fn(async () => ({ output: { note: "Oct 5:" } }));
    await expect(writeTimelineNote({ clusterTitle: "t", priorLines: [], excerpt: "x" }, { generateImpl: empty as never })).rejects.toThrow();
  });
});
