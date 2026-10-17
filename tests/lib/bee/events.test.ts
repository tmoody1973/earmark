import { describe, expect, it } from "vitest";
import { isJournalComplete, parseBeeEnvelope } from "../../../agent/lib/bee/events";

// What the relay sends: {"event":"{{event}}","ts":"{{timestamp}}","data":{{raw}}}
const wrap = (event: string, data: unknown) => JSON.parse(JSON.stringify({ event, ts: "2026-10-16T15:00:00.000Z", data }));

describe("parseBeeEnvelope", () => {
  it("parses new-utterance with quotes, newlines and emoji intact", () => {
    const text = 'She said "you have to try it"\nreally 🍜 — ¡increíble!';
    const evt = parseBeeEnvelope(wrap("new-utterance", { utterance: { text, speaker: "Unknown" }, conversation_uuid: "u-1" }));
    expect(evt.event).toBe("new-utterance");
    if (evt.event !== "new-utterance") throw new Error("narrowing");
    expect(evt.data.utterance.text).toBe(text);
  });

  it("survives a body that went through the relay's raw JSON template", () => {
    const raw = JSON.stringify({ utterance: { text: 'a "quoted" line', speaker: "speaker_1" }, conversation_uuid: "u-2" });
    const body = JSON.parse(`{"event":"new-utterance","ts":"x","data":${raw}}`);
    expect(parseBeeEnvelope(body).event).toBe("new-utterance");
  });

  it("parses the live new-utterance shape (observed 2026-10-16): utterance id and spoken_at, no speaker", () => {
    const data = {
      type: "new-utterance", conversation_uuid: "0fe1bdc8-9cd0-4180-84e1-bd936e430b6c",
      utterance: { id: 3766760407, sample_id: "1941b7cd-2955-4db7-a678-6ea75c7a62f0", start: 680.16, end: 691.36, text: "hello", spoken_at: "2026-10-16T18:05:13.000Z" },
    };
    const evt = parseBeeEnvelope(wrap("new-utterance", data));
    if (evt.event !== "new-utterance") throw new Error("narrowing");
    expect(evt.data.utterance).toMatchObject({ id: 3766760407, speaker: "Unknown", text: "hello", spoken_at: "2026-10-16T18:05:13.000Z" });
    expect(evt.data.conversation_uuid).toBe("0fe1bdc8-9cd0-4180-84e1-bd936e430b6c");
  });

  it("parses each conversation, location, todo and journal event", () => {
    const cases: Array<[string, unknown]> = [
      ["new-conversation", { conversation: { id: 123, uuid: "u", state: "processing", title: null } }],
      ["update-conversation", { conversation: { id: 123, state: "processed", short_summary: "s" } }],
      ["update-conversation-summary", { conversation_id: 123, short_summary: "Summary" }],
      ["delete-conversation", { conversation: { id: 123, title: "t" } }],
      ["update-location", { conversation_id: 123, location: { latitude: 43.04, longitude: -87.9, name: "MKE" } }],
      ["todo-created", { todo: { id: 10, text: "Call", completed: false, alarmAt: 1700000000000 } }],
      ["todo-updated", { todo: { id: 10, text: "Call", completed: true, alarmAt: null } }],
      ["todo-deleted", { todo: { id: 10, text: "Call" } }],
      ["journal-created", { journal: { id: 55, state: "processed", text: "Earmark that", aiResponse: { message: "m" } } }],
      ["journal-updated", { journal: { id: 55, state: "processed", text: "Earmark that" } }],
      ["journal-deleted", { journalId: 55, reason: "user" }],
      ["journal-text", { journalId: 55, text: "Earmark th" }],
      ["connected", {}],
    ];
    for (const [event, data] of cases) expect(parseBeeEnvelope(wrap(event, data)).event).toBe(event);
  });

  it("normalizes journal ids to strings", () => {
    const evt = parseBeeEnvelope(wrap("journal-updated", { journal: { id: 55, state: "processed", text: "x" } }));
    if (evt.event !== "journal-updated") throw new Error("narrowing");
    expect(evt.data.journal.id).toBe("55");
  });

  it("coerces numeric ids from stream (journal.id, journalId) to strings", () => {
    const a = parseBeeEnvelope(wrap("journal-created", { journal: { id: 55, text: "x" } }));
    const b = parseBeeEnvelope(wrap("journal-deleted", { journalId: 55 }));
    const c = parseBeeEnvelope(wrap("journal-text", { journalId: "55", text: "t" }));
    if (a.event !== "journal-created" || b.event !== "journal-deleted" || c.event !== "journal-text") throw new Error("narrowing");
    expect([a.data.journal.id, b.data.journalId, c.data.journalId]).toEqual(["55", "55", "55"]);
  });

  it("rejects unknown events and malformed data", () => {
    expect(() => parseBeeEnvelope(wrap("mystery-event", {}))).toThrow();
    expect(() => parseBeeEnvelope(wrap("new-utterance", { utterance: {} }))).toThrow();
    expect(() => parseBeeEnvelope("not an object")).toThrow();
  });
});

describe("isJournalComplete", () => {
  it("is true for processed, ready, completed in any case", () => {
    for (const s of ["processed", "READY", "Completed", "ready"]) expect(isJournalComplete(s)).toBe(true);
  });
  it("is false for in-flight, unknown and missing states", () => {
    for (const s of ["PREPARING", "ANALYZING", "", "mystery", null, undefined]) expect(isJournalComplete(s)).toBe(false);
  });
});

describe("conversationRef", () => {
  it("returns the pair from one level, in priority order", async () => {
    const { conversationRef } = await import("../../../agent/lib/bee/events");
    expect(conversationRef({ conversation: { uuid: "u", id: 1 }, conversation_uuid: "x", conversation_id: 2 })).toEqual({ uuid: "u", id: 1 });
    expect(conversationRef({ conversation_uuid: "u", conversation_id: 2 })).toEqual({ uuid: "u", id: 2 });
    expect(conversationRef({ uuid: "u", id: "3" })).toEqual({ uuid: "u", id: 3 });
  });
  it("never mixes levels, and rejects unsafe ids", async () => {
    const { conversationRef } = await import("../../../agent/lib/bee/events");
    expect(conversationRef({ conversation: { uuid: "u" }, conversation_id: 5 })).toBeNull();
    expect(conversationRef({ conversation_uuid: "u", id: 5 })).toBeNull();
    expect(conversationRef({ conversation: { uuid: "u", id: "99999999999999999999" } })).toBeNull();
  });
});
