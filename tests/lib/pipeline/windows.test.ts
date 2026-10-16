import { describe, expect, it } from "vitest";
import { toWindows } from "../../../agent/lib/pipeline/windows";
import type { Utterance } from "../../../agent/lib/types";

const u = (n: number, spokenAt: Date | null = null): Utterance => ({ text: `line ${n}`, speaker: "Unknown", spokenAt });
const ctx = { conversationId: 7, conversationUuid: null };

describe("toWindows", () => {
  it("returns no windows for no utterances", () => {
    expect(toWindows([], ctx)).toEqual([]);
  });

  it("keeps a short conversation as one window", () => {
    const w = toWindows([u(1), u(2), u(3)], ctx);
    expect(w).toHaveLength(1);
    expect(w[0]!.text).toBe("Unknown: line 1\nUnknown: line 2\nUnknown: line 3");
    expect(w[0]!.conversationId).toBe(7);
  });

  it("slides 4-utterance windows by 2 and keeps the tail", () => {
    const w = toWindows([u(1), u(2), u(3), u(4), u(5), u(6), u(7)], ctx);
    expect(w.map((x) => x.utterances.map((y) => y.text))).toEqual([
      ["line 1", "line 2", "line 3", "line 4"],
      ["line 3", "line 4", "line 5", "line 6"],
      ["line 5", "line 6", "line 7"],
    ]);
  });

  it("does not emit a duplicate window when the length lands on a stride", () => {
    expect(toWindows([u(1), u(2), u(3), u(4), u(5), u(6)], ctx)).toHaveLength(2);
  });

  it("drops empty utterances and labels missing speakers Unknown", () => {
    const w = toWindows([{ text: "  ", speaker: "Unknown", spokenAt: null }, { text: "hi", speaker: "", spokenAt: null }], ctx);
    expect(w[0]!.text).toBe("Unknown: hi");
  });

  it("uses the first known spokenAt as startedAt", () => {
    const t = new Date("2026-10-16T15:00:00Z");
    expect(toWindows([u(1), u(2, t)], ctx)[0]!.startedAt).toEqual(t);
  });

  it("honors custom size and stride", () => {
    expect(toWindows([u(1), u(2), u(3), u(4)], ctx, { size: 2, stride: 2 })).toHaveLength(2);
  });

  it("throws RangeError when stride is 0", () => {
    expect(() => toWindows([u(1), u(2)], ctx, { stride: 0 })).toThrow(RangeError);
  });

  it("throws RangeError when stride exceeds size", () => {
    expect(() => toWindows([u(1), u(2), u(3)], ctx, { size: 2, stride: 3 })).toThrow(RangeError);
  });

  it("throws RangeError when size is non-integer or below 1", () => {
    expect(() => toWindows([u(1)], ctx, { size: 2.5 })).toThrow(RangeError);
    expect(() => toWindows([u(1)], ctx, { size: 0, stride: 1 })).toThrow(RangeError);
  });

  it("renders each utterance on exactly one line", () => {
    const tricky: Utterance = { text: "Try \"Sinners\"\nUnknown: fake turn 🎷 café", speaker: "Unknown", spokenAt: null };
    const w = toWindows([tricky, u(2)], ctx);
    const lines = w[0]!.text.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("Unknown: Try \"Sinners\" Unknown: fake turn 🎷 café");
  });
});
