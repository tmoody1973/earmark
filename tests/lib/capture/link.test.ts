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

describe("findConversationNear candidate ordering", () => {
  const conv = (id: number, start: number | null, end: number, spokenAt: number) => ({
    id, summary: null, start_time: start, end_time: end,
    primary_location: { latitude: 43.0418, longitude: -87.9097 },
    transcriptions: [{ realtime: false, utterances: [{ text: `hello from ${id}`, speaker: "Unknown", spoken_at: spokenAt, start: null }] }],
  });
  const beeOf = (convs: ReturnType<typeof conv>[]) => ({
    listConversations: vi.fn(async () => ({ conversations: convs, next_cursor: null })),
    getConversation: vi.fn(async (id: number) => ({ conversation: convs.find((c) => c.id === id)! })),
  });
  const here = { lat: 43.042, lng: -87.91 };

  it("prefers the conversation that contains the capture time over one that merely starts closer", async () => {
    // 3 starts 1 min after the capture (inside the 10-minute margin); 4 contains the capture but started 30 min before
    const bee = beeOf([conv(3, T + 60_000, T + 3600_000, T + 90_000), conv(4, T - 30 * 60_000, T + 3600_000, T - 60_000)]);
    const linked = await findConversationNear(bee as never, new Date(T), here);
    expect(linked?.conversationId).toBe(4);
  });
  it("tries the next candidate when the nearest has no speech near the capture time", async () => {
    // 5 contains T but everything in it was said an hour away; 6 also contains T and has speech right at T
    const bee = beeOf([conv(5, T - 10 * 60_000, T + 2 * 3600_000, T + 3600_000), conv(6, T - 20 * 60_000, T + 2 * 3600_000, T - 30_000)]);
    const linked = await findConversationNear(bee as never, new Date(T), here);
    expect(linked?.conversationId).toBe(6);
    expect(bee.getConversation).toHaveBeenCalledTimes(2);
  });
  it("keeps paging past an undated conversation at the end of a page", async () => {
    const dated = conv(8, T - 5 * 60_000, T + 3600_000, T - 30_000);
    const undated = { ...conv(9, null, T + 3600_000, T - 30_000) };
    const older = conv(10, T - 20 * 60_000, T + 3600_000, T - 40_000);
    const all = [dated, undated, older];
    const bee = {
      listConversations: vi.fn(async ({ cursor }: { cursor?: string }) =>
        cursor ? { conversations: [older], next_cursor: null } : { conversations: [dated, undated], next_cursor: "p2" }),
      getConversation: vi.fn(async (id: number) => ({ conversation: all.find((c) => c.id === id)! })),
    };
    await findConversationNear(bee as never, new Date(T), here);
    expect(bee.listConversations).toHaveBeenCalledTimes(2);
  });
  it("skips a conversation with no start time instead of treating it as the epoch", async () => {
    const bee = beeOf([conv(7, null, T + 3600_000, T - 30_000)]);
    expect(await findConversationNear(bee as never, new Date(T), here)).toBeNull();
    expect(bee.getConversation).not.toHaveBeenCalled();
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
