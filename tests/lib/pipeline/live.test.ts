import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BeeClient } from "../../../agent/lib/bee/client";
import type { SaveItem } from "../../../agent/lib/pipeline/save-item";
import type { TriageResult } from "../../../agent/lib/types";

const conv = vi.hoisted(() => ({ bufferUtterance: vi.fn(async () => {}), rememberConversationUuid: vi.fn(async () => {}) }));
vi.mock("../../../agent/lib/store/conversations", () => conv);
const buf = vi.hoisted(() => ({
  LIVE_WINDOW: { size: 4, stride: 4 },
  claimUtterances: vi.fn(),
  finishUtterancesQuery: vi.fn((_txn: unknown, ids: number[]) => ({ finish: ids })),
  conversationIdForUuid: vi.fn(),
}));
vi.mock("../../../agent/lib/store/utterances", () => buf);
const win = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock("../../../agent/lib/pipeline/windows", async (orig) => {
  const real = await orig<typeof import("../../../agent/lib/pipeline/windows")>();
  return { toWindows: (...args: Parameters<typeof real.toWindows>) => { win.calls.push(args); return real.toWindows(...args); } };
});
const compost = vi.hoisted(() => ({
  planIdeaClusters: vi.fn(async (items: SaveItem[], _deps?: unknown) => items.map((it) => ({ ...it, cluster: { action: "join" as const, clusterId: 9, embedding: [1] } }))),
}));
vi.mock("../../../agent/lib/ideas/compost", () => compost);
const tx = vi.hoisted(() => ({ statements: [] as unknown[] }));
vi.mock("../../../agent/lib/db", () => ({
  db: () => ({
    transaction: async (fn: (txn: unknown) => unknown[]) => {
      tx.statements = fn(((s: TemplateStringsArray) => s.join("?")) as unknown);
      return tx.statements.map(() => [{ id: 31, cluster_id: 9, prev_stage: "sprouting", next_stage: "ready" }]);
    },
  }),
}));

import { handleLiveUtterance } from "../../../agent/lib/pipeline/live";

const at = (s: number) => new Date(Date.UTC(2026, 9, 17, 15, 0, s));
const row = (id: number, text: string) => ({ id, speaker: "Unknown", text, receivedAt: at(id) });
const rows4 = [row(1, "so I keep thinking"), row(2, "about a newsletter"), row(3, "on AI in public radio"), row(4, "every Friday")];
const tri = (over: Partial<TriageResult> = {}): TriageResult => ({
  kind: "idea_by_user", kindProbability: 0.93, recType: "none", recTypeProbability: 0.9,
  jokingProbability: 0.05, broadcastProbability: 0.02, model: "m", providerMetadata: null, ...over,
});
const bee = (over: Partial<BeeClient> = {}) => ({
  listConversations: vi.fn(async () => ({ conversations: [] })),
  getConversation: vi.fn(),
  ...over,
}) as unknown as BeeClient;
const deps = () => ({
  bee: bee(),
  triage: vi.fn(async (_text: string) => tri()),
  extractIdea: vi.fn(async (_text: string) => ({ title: "AI in public radio newsletter", excerpt: "a newsletter on AI in public radio" })),
  now: () => at(59),
  compost: { embedText: async () => [1] },
});
const u = { conversationUuid: "uuid-1", speaker: "Unknown", text: "every Friday", utteranceId: 3766760407 };

beforeEach(() => {
  vi.clearAllMocks();
  tx.statements = [];
  buf.claimUtterances.mockResolvedValue({ claimed: [1, 2, 3, 4], rows: rows4 });
  buf.conversationIdForUuid.mockResolvedValue(777);
});

describe("handleLiveUtterance", () => {
  it("buffers every utterance and makes no model call until a window is claimed", async () => {
    buf.claimUtterances.mockResolvedValue(null);
    const d = deps();
    expect(await handleLiveUtterance(u, d)).toEqual({ triaged: false, windows: 0, ideas: 0 });
    expect(conv.bufferUtterance).toHaveBeenCalledWith("uuid-1", "Unknown", "every Friday", null);
    expect(d.triage).not.toHaveBeenCalled();
    expect(tx.statements).toEqual([]);
  });

  it("triages the claimed window once and saves an accepted idea through the compost plan, finishing the claim in the same transaction", async () => {
    const d = deps();
    const out = await handleLiveUtterance(u, d);
    expect(d.triage).toHaveBeenCalledTimes(1);
    expect(d.triage).toHaveBeenCalledWith("Unknown: so I keep thinking\nUnknown: about a newsletter\nUnknown: on AI in public radio\nUnknown: every Friday");
    expect(compost.planIdeaClusters).toHaveBeenCalledWith([{
      kind: "idea", route: "accept", extraction: { title: "AI in public radio newsletter", excerpt: "a newsletter on AI in public radio" },
      beeConversationId: 777, beeConversationUuid: "uuid-1", beeJournalId: null, spokenAt: at(1), confidence: 0.93, source: "ambient",
    }], d.compost);
    expect(tx.statements).toHaveLength(2);
    expect(tx.statements.at(-1)).toEqual({ finish: [1, 2, 3, 4] });
    expect(out).toEqual({ triaged: true, windows: 1, ideas: 1, saved: { recIds: [], ideaClusterIds: [9], mentionIds: [31], bloomedClusterIds: [9] } });
  });

  it("saves a review-band idea too (decision 004: it counts)", async () => {
    const d = { ...deps(), triage: vi.fn(async () => tri({ kindProbability: 0.7 })) };
    await handleLiveUtterance(u, d);
    expect(compost.planIdeaClusters.mock.calls[0]![0]).toMatchObject([{ route: "review", confidence: 0.7 }]);
  });

  it.each([
    ["a recommendation (recs wait for the completed pass)", tri({ kind: "rec_to_user", recType: "album" })],
    ["a joke", tri({ jokingProbability: 0.8 })],
    ["broadcast audio", tri({ broadcastProbability: 0.9 })],
    ["nothing", tri({ kind: "neither" })],
  ])("extracts nothing for %s but still finishes the claim", async (_label, result) => {
    const d = { ...deps(), triage: vi.fn(async () => result) };
    expect(await handleLiveUtterance(u, d)).toMatchObject({ triaged: true, windows: 1, ideas: 0 });
    expect(d.extractIdea).not.toHaveBeenCalled();
    expect(tx.statements).toEqual([{ finish: [1, 2, 3, 4] }]);
  });

  it("claims and windows with LIVE_WINDOW (4, non-overlapping): 8 claimed utterances are exactly 2 windows", async () => {
    const rows8 = [...rows4, row(5, "e"), row(6, "f"), row(7, "g"), row(8, "h")];
    buf.claimUtterances.mockResolvedValue({ claimed: [1, 2, 3, 4, 5, 6, 7, 8], rows: rows8 });
    const d = { ...deps(), triage: vi.fn(async (_t: string) => tri({ kind: "neither" })) };
    expect(await handleLiveUtterance(u, d)).toMatchObject({ windows: 2 });
    expect(d.triage).toHaveBeenCalledTimes(2);
    expect(d.triage.mock.calls[1]![0]).toBe("Unknown: e\nUnknown: f\nUnknown: g\nUnknown: h");
    expect(buf.claimUtterances).toHaveBeenCalledWith("uuid-1", buf.LIVE_WINDOW);
    expect(win.calls.at(-1)![2]).toBe(buf.LIVE_WINDOW);
  });

  it("dates a live mention by the stream's spoken_at when it was buffered (receivedAt otherwise)", async () => {
    const said = new Date("2026-10-17T14:59:00Z");
    buf.claimUtterances.mockResolvedValue({ claimed: [1, 2, 3, 4], rows: rows4.map((r, i) => (i === 0 ? { ...r, spokenAt: said } : r)) });
    await handleLiveUtterance({ ...u, spokenAt: said }, deps());
    expect(conv.bufferUtterance).toHaveBeenCalledWith("uuid-1", "Unknown", "every Friday", said);
    expect(compost.planIdeaClusters.mock.calls[0]![0]).toMatchObject([{ spokenAt: said }]);
  });

  it("resolves an unmapped stream uuid by finding its utterance id in a still-capturing conversation, and remembers it", async () => {
    buf.conversationIdForUuid.mockResolvedValue(null);
    const getConversation = vi.fn(async (id: number) => ({
      conversation: { id, state: "CAPTURING", transcriptions: [{ realtime: true, utterances: [{ id: 3766760407, text: "x", speaker: "Unknown" }] }] },
    }));
    const listConversations = vi.fn(async () => ({ conversations: [{ id: 5, state: "COMPLETED" }, { id: 11333494, state: "CAPTURING" }] }));
    const d = { ...deps(), bee: bee({ listConversations, getConversation } as never) };
    await handleLiveUtterance(u, d);
    expect(getConversation).toHaveBeenCalledTimes(1);
    expect(getConversation).toHaveBeenCalledWith(11333494);
    expect(conv.rememberConversationUuid).toHaveBeenCalledWith("uuid-1", 11333494);
    expect(compost.planIdeaClusters.mock.calls[0]![0]).toMatchObject([{ beeConversationId: 11333494, beeConversationUuid: "uuid-1" }]);
  });

  it("still saves with the uuid alone when the lookup fails, logging ids and the error name only", async () => {
    buf.conversationIdForUuid.mockResolvedValue(null);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const d = { ...deps(), bee: bee({ listConversations: vi.fn(async () => { throw new TypeError("secret words"); }) } as never) };
    await handleLiveUtterance(u, d);
    expect(compost.planIdeaClusters.mock.calls[0]![0]).toMatchObject([{ beeConversationId: null, beeConversationUuid: "uuid-1" }]);
    expect(err.mock.calls.flat().join(" ")).toContain("error=TypeError");
    expect(err.mock.calls.flat().join(" ")).not.toContain("secret");
    err.mockRestore();
  });

  it("does not look anything up without a stream utterance id", async () => {
    buf.conversationIdForUuid.mockResolvedValue(null);
    const d = deps();
    await handleLiveUtterance({ ...u, utteranceId: null }, d);
    expect(d.bee.listConversations).not.toHaveBeenCalled();
  });

  it("a model failure leaves the claim unfinished (its lease lets a later delivery retry) and rethrows", async () => {
    const d = { ...deps(), triage: vi.fn(async () => { throw new Error("gateway down"); }) };
    await expect(handleLiveUtterance(u, d)).rejects.toThrow("gateway down");
    expect(tx.statements).toEqual([]);
  });
});
