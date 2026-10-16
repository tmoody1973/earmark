import { describe, expect, it } from "vitest";
import { latestBloom } from "../../app/bloom-ticker";

const ev = (id: number, kind: "mention" | "bloom", title = `idea ${id}`, mentionCount = 3) => ({ id, kind, title, mentionCount });

describe("latestBloom", () => {
  it("announces the newest unseen bloom in plain words", () => {
    const seen = new Set<number>();
    expect(latestBloom([ev(1, "bloom", "AI newsletter"), ev(2, "mention")], seen)).toBe("AI newsletter bloomed — mentioned 3 times.");
    expect([...seen]).toEqual([1, 2]);
  });

  it("ignores mentions and events already announced (polls overlap on purpose)", () => {
    const seen = new Set<number>([1]);
    expect(latestBloom([ev(1, "bloom"), ev(2, "mention")], seen)).toBeNull();
    expect(latestBloom([ev(3, "bloom", "Record stores", 4), ev(4, "bloom", "Late show", 3)], seen)).toBe("Late show bloomed — mentioned 3 times.");
  });
});
