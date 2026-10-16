import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../agent/lib/store/conversations", () => ({
  rememberConversationUuid: vi.fn(async () => {}),
  pruneUtteranceBuffer: vi.fn(async () => {}),
}));
vi.mock("../../../agent/lib/pipeline/live", () => ({ handleLiveUtterance: vi.fn(async () => ({ triaged: false, windows: 0, ideas: 0 })) }));
vi.mock("../../../agent/lib/pipeline/process-conversation", () => ({
  processConversation: vi.fn(async () => ({ skipped: false, ideas: 0, recs: 1, reviews: 0 })),
}));
vi.mock("../../../agent/lib/pipeline/process-journal", () => ({ processJournal: vi.fn(async () => ({ created: "rec" })) }));
vi.mock("../../../agent/lib/ideas/one-pager", () => ({ draftBlooms: vi.fn(async () => []) }));

import { pruneUtteranceBuffer, rememberConversationUuid } from "../../../agent/lib/store/conversations";
import { handleLiveUtterance } from "../../../agent/lib/pipeline/live";
import { processConversation } from "../../../agent/lib/pipeline/process-conversation";
import { processJournal } from "../../../agent/lib/pipeline/process-journal";
import { handleBeeEvent } from "../../../agent/lib/pipeline/ingest";
import { parseBeeEnvelope } from "../../../agent/lib/bee/events";
import { draftBlooms } from "../../../agent/lib/ideas/one-pager";

const evt = (event: string, data: unknown) => parseBeeEnvelope({ event, ts: "t", data });
const now = () => new Date("2026-10-16T16:00:00Z");

beforeEach(() => vi.clearAllMocks());

describe("handleBeeEvent", () => {
  it("hands new utterances to the live path (buffer + windowed triage), passing deps through", async () => {
    await handleBeeEvent(evt("new-utterance", { utterance: { text: "hi", speaker: "Unknown" }, conversation_uuid: "u1" }));
    expect(handleLiveUtterance).toHaveBeenCalledWith({ conversationUuid: "u1", speaker: "Unknown", text: "hi", utteranceId: null, spokenAt: null }, {});
    await handleBeeEvent(evt("new-utterance", { utterance: { id: 3766760407, text: "yo", spoken_at: "2026-10-16T18:05:13.000Z" }, conversation_uuid: "u2" }), { now });
    expect(handleLiveUtterance).toHaveBeenCalledWith(
      { conversationUuid: "u2", speaker: "Unknown", text: "yo", utteranceId: 3766760407, spokenAt: new Date("2026-10-16T18:05:13.000Z") }, { now },
    );
  });

  it("still prunes when the live path fails", async () => {
    vi.mocked(handleLiveUtterance).mockRejectedValueOnce(new Error("gateway"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await handleBeeEvent(evt("new-utterance", { utterance: { text: "hi" }, conversation_uuid: "u1" }), { now: () => new Date(Date.UTC(2029, 0, 1)) }); // before the 2030 prune test's clock
    expect(pruneUtteranceBuffer).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(err.mock.calls)).toContain("new-utterance");
    err.mockRestore();
  });

  it("prunes old buffered utterances at most once per hour per process", async () => {
    // far-future clock so earlier tests (real clock) never count as a recent prune
    const at = (min: number) => () => new Date(Date.UTC(2030, 0, 1) + min * 60_000);
    const utter = evt("new-utterance", { utterance: { text: "hi", speaker: "Unknown" }, conversation_uuid: "u1" });
    await handleBeeEvent(utter, { now: at(0) });
    await handleBeeEvent(utter, { now: at(10) });
    await handleBeeEvent(utter, { now: at(59) });
    expect(pruneUtteranceBuffer).toHaveBeenCalledTimes(1);
    await handleBeeEvent(utter, { now: at(61) });
    expect(pruneUtteranceBuffer).toHaveBeenCalledTimes(2);
    expect(handleLiveUtterance).toHaveBeenCalledTimes(4); // buffering never waits on the prune guard
  });

  it("maps conversation uuid to id", async () => {
    await handleBeeEvent(evt("new-conversation", { conversation: { id: 12, uuid: "u1" } }));
    expect(rememberConversationUuid).toHaveBeenCalledWith("u1", 12);
  });

  it("processes a conversation when its summary arrives, passing deps through", async () => {
    await handleBeeEvent(evt("update-conversation-summary", { conversation_id: 12, short_summary: "s" }));
    expect(processConversation).toHaveBeenCalledWith(12, {});
    await handleBeeEvent(evt("update-conversation-summary", { conversation_id: 13 }), { now });
    expect(processConversation).toHaveBeenCalledWith(13, { now });
  });

  it.each(["processed", "READY", "completed"])("processes a finished journal (state %s)", async (state) => {
    await handleBeeEvent(evt("journal-updated", { journal: { id: 55, state, text: "Earmark that, Ann's ramen spot" } }), { now });
    expect(processJournal).toHaveBeenCalledWith({ id: "55", text: "Earmark that, Ann's ramen spot", createdAt: now() }, { now });
  });

  it("processes a finished journal delivered as journal-created", async () => {
    await handleBeeEvent(evt("journal-created", { journal: { id: 56, state: "processed", text: "Earmark that, x" } }), { now });
    expect(processJournal).toHaveBeenCalledTimes(1);
  });

  it("ignores journals that are still being transcribed, empty, or partial text", async () => {
    await handleBeeEvent(evt("journal-created", { journal: { id: 55, state: "preparing", text: "Earmark th" } }));
    await handleBeeEvent(evt("journal-updated", { journal: { id: 55, state: "processed", text: null } }));
    await handleBeeEvent(evt("journal-updated", { journal: { id: 55, state: "processed", text: "   " } }));
    await handleBeeEvent(evt("journal-text", { journalId: 55, text: "Earmark that" }));
    expect(processJournal).not.toHaveBeenCalled();
  });

  it("logs only the event name for events no milestone handles yet", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleBeeEvent(evt("todo-created", { todo: { id: 1, text: "secret todo text" } }));
    expect(log).toHaveBeenCalledWith("[bee] ignored todo-created");
    log.mockRestore();
  });

  it("catches a handler failure and logs the event type, never the text", async () => {
    vi.mocked(processJournal).mockRejectedValueOnce(new Error("boom: Earmark that, Ann's ramen spot"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      handleBeeEvent(evt("journal-updated", { journal: { id: 55, state: "processed", text: "Earmark that, Ann's ramen spot" } })),
    ).resolves.toBeUndefined();
    const logged = JSON.stringify(err.mock.calls);
    expect(logged).toContain("journal-updated");
    expect(logged).not.toContain("ramen");
    err.mockRestore();
  });

  // M2-T7: a bloom is drafted right after its save transaction committed, still inside the request's after()/waitUntil.
  describe("drafting a one-pager after a bloom", () => {
    const saved = (bloomedClusterIds: number[]) => ({ recIds: [], ideaClusterIds: [12], mentionIds: [1], bloomedClusterIds });
    const quiet = () => vi.spyOn(console, "log").mockImplementation(() => {});

    it("live: drafts the clusters the save just bloomed, after the save returned", async () => {
      quiet();
      vi.mocked(handleLiveUtterance).mockResolvedValueOnce({ triaged: true, windows: 1, ideas: 1, saved: saved([12]) });
      await handleBeeEvent(evt("new-utterance", { utterance: { text: "hi" }, conversation_uuid: "u1" }));
      expect(draftBlooms).toHaveBeenCalledWith({ clusterIds: [12] });
      expect(vi.mocked(handleLiveUtterance).mock.invocationCallOrder[0]!).toBeLessThan(vi.mocked(draftBlooms).mock.invocationCallOrder[0]!);
    });

    it("conversation and voice note saves that bloomed draft too", async () => {
      quiet();
      vi.mocked(processConversation).mockResolvedValueOnce({ skipped: false, ideas: 1, recs: 0, reviews: 0, failed: 0, incomplete: false, saved: saved([7]) });
      await handleBeeEvent(evt("update-conversation-summary", { conversation_id: 12 }));
      expect(draftBlooms).toHaveBeenLastCalledWith({ clusterIds: [7] });
      vi.mocked(processJournal).mockResolvedValueOnce({ created: "idea", saved: saved([8]) });
      await handleBeeEvent(evt("journal-updated", { journal: { id: 55, state: "processed", text: "x" } }));
      expect(draftBlooms).toHaveBeenLastCalledWith({ clusterIds: [8] });
    });

    it("no bloom, no draft call", async () => {
      quiet();
      vi.mocked(handleLiveUtterance).mockResolvedValueOnce({ triaged: true, windows: 1, ideas: 1, saved: saved([]) });
      await handleBeeEvent(evt("new-utterance", { utterance: { text: "hi" }, conversation_uuid: "u1" }));
      await handleBeeEvent(evt("update-conversation-summary", { conversation_id: 12 }));
      expect(draftBlooms).not.toHaveBeenCalled();
    });
  });
});
