import { describe, expect, it, vi } from "vitest";
import { attributeFromWindow, findConversationNear, pickWindowForCapture } from "../../../agent/lib/capture/link";
import type { TranscriptWindow } from "../../../agent/lib/types";

const T = Date.parse("2026-10-18T19:00:00Z");

function fakeBee() {
  return {
    listConversations: vi.fn(async () => ({
      conversations: [
        { id: 2, start_time: T - 5 * 60_000, end_time: T + 20 * 60_000, summary: null, state: "COMPLETED" },
        { id: 1, start_time: T - 5 * 3600_000, end_time: T - 4 * 3600_000, summary: null, state: "COMPLETED" },
      ],
      next_cursor: null,
    })),
    getConversation: vi.fn(async (id: number) => ({
      conversation: {
        id,
        summary: "Dinner with Ann",
        start_time: T - 5 * 60_000,
        end_time: T + 20 * 60_000,
        primary_location: { latitude: 43.0418, longitude: -87.9097 },
        transcriptions: [
          {
            realtime: false,
            utterances: [
              { text: "You have to hear Promises", speaker: "Unknown", spoken_at: T - 60_000, start: null },
              { text: "Floating Points and Pharoah Sanders", speaker: "Unknown", spoken_at: T - 50_000, start: null },
            ],
          },
        ],
      },
    })),
  };
}

describe("findConversationNear", () => {
  it("returns the conversation that spans the capture time and is nearby", async () => {
    const bee = fakeBee();
    const linked = await findConversationNear(bee as never, new Date(T), { lat: 43.042, lng: -87.91 });
    expect(linked?.conversationId).toBe(2);
    expect(linked?.windows.length).toBeGreaterThan(0);
    expect(bee.getConversation).toHaveBeenCalledTimes(1);
  });
  it("skips a conversation recorded more than 500 m away", async () => {
    const bee = fakeBee();
    const linked = await findConversationNear(bee as never, new Date(T), { lat: 43.1, lng: -87.9 });
    expect(linked).toBeNull();
  });
  it("returns null when nothing is within 10 minutes", async () => {
    const bee = fakeBee();
    const linked = await findConversationNear(bee as never, new Date(T + 3 * 3600_000), null);
    expect(linked).toBeNull();
  });
});

describe("pickWindowForCapture", () => {
  const w = (text: string): TranscriptWindow => ({
    conversationId: 2, conversationUuid: null, utterances: [], text, startedAt: null,
  });
  it("uses letter keys, not numbers, and maps the choice back to the window", async () => {
    const decideImpl = vi.fn(async (opts: { questions: { window: { criteria: Record<string, string> } } }) => {
      expect(Object.keys(opts.questions.window.criteria)).toEqual(["w_a", "w_b", "none"]);
      return { answers: { window: { type: "choice", choice: "w_b", probabilities: { w_b: 0.91 } } } };
    });
    const picked = await pickWindowForCapture("Promises by Floating Points", [w("weather"), w("Promises")], decideImpl as never);
    expect(picked?.window.text).toBe("Promises");
    expect(picked?.probability).toBe(0.91);
  });
  it("returns null for 'none' or low probability", async () => {
    const none = vi.fn(async () => ({ answers: { window: { type: "choice", choice: "none", probabilities: { none: 0.8 } } } }));
    expect(await pickWindowForCapture("x", [w("a")], none as never)).toBeNull();
    const weak = vi.fn(async () => ({ answers: { window: { type: "choice", choice: "w_a", probabilities: { w_a: 0.4 } } } }));
    expect(await pickWindowForCapture("x", [w("a")], weak as never)).toBeNull();
  });
});

describe("attributeFromWindow", () => {
  const win: TranscriptWindow = {
    conversationId: 2, conversationUuid: null, utterances: [], startedAt: null,
    text: "Unknown: Ann, you have to hear Promises by Floating Points",
  };
  const ext = (recommenderName: string | null, excerpt = "you have to hear Promises") =>
    vi.fn(async () => ({ canonicalName: "Promises", creator: null, recommenderName, excerpt }));

  it("credits a first name the window supports", async () => {
    const out = await attributeFromWindow(win, null, ext("Ann") as never);
    expect(out).toEqual({ firstName: "Ann", source: "second_person", excerpt: "you have to hear Promises" });
  });
  it("never credits the owner", async () => {
    vi.stubEnv("EARMARK_OWNER_FIRST_NAME", "Ann");
    try {
      const out = await attributeFromWindow(win, null, ext("Ann") as never);
      expect(out.firstName).toBeNull();
      expect(out.source).toBe("none");
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("clamps the excerpt to 25 words", async () => {
    const long = Array.from({ length: 40 }, (_, i) => `w${i}`).join(" ");
    const out = await attributeFromWindow(win, null, ext(null, long) as never);
    expect(out.excerpt.split(/\s+/).length).toBeLessThanOrEqual(25);
  });
});
