import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("../../../agent/lib/garden/queries", () => ({
  getGardenVisit: vi.fn(async () => null),
  saveGardenVisit: vi.fn(async () => {}),
  setTipVerdict: vi.fn(async () => true),
}));
vi.mock("../../../agent/lib/garden/backlinks", () => ({ setLinkStatus: vi.fn(async () => true) }));
vi.mock("../../../agent/lib/garden/merge", () => ({ mergeClusters: vi.fn(async () => 41), undoMerge: vi.fn(async () => true) }));

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getGardenVisit, saveGardenVisit, setTipVerdict } from "../../../agent/lib/garden/queries";
import { setLinkStatus } from "../../../agent/lib/garden/backlinks";
import { mergeClusters, undoMerge } from "../../../agent/lib/garden/merge";
import { acceptLink, keepTip, mergeIdeas, notATip, recordGardenVisit, removeLink, undoIdeaMerge } from "../../../app/garden/actions";

const signedInAs = (userId: string | null) => vi.mocked(auth).mockResolvedValue({ userId } as never);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.EARMARK_OWNER_CLERK_ID = "user_owner";
});

// A visit is recorded when the garden mounts or becomes visible (GardenLive), never by a server render, so
// router.refresh() cannot count as a look.
describe("recordGardenVisit", () => {
  it("refuses anyone but the owner, without touching the record", async () => {
    signedInAs("user_stranger");
    await expect(recordGardenVisit()).rejects.toThrow(/not found/i);
    expect(getGardenVisit).not.toHaveBeenCalled();
    expect(saveGardenVisit).not.toHaveBeenCalled();
  });

  it("inside the same visit: moves lastVisit on, keeps the baseline, reports no new visit", async () => {
    signedInAs("user_owner");
    const lastVisit = new Date(Date.now() - 60_000).toISOString();
    vi.mocked(getGardenVisit).mockResolvedValueOnce({ seenBefore: "2026-10-01T00:00:00.000Z", lastVisit });
    expect(await recordGardenVisit()).toEqual({ started: false });
    expect(saveGardenVisit).toHaveBeenCalledWith(expect.objectContaining({ seenBefore: "2026-10-01T00:00:00.000Z" }));
  });

  it("after the gap: a new visit starts and its baseline is the last look", async () => {
    signedInAs("user_owner");
    vi.mocked(getGardenVisit).mockResolvedValueOnce({ seenBefore: null, lastVisit: "2026-10-01T00:00:00.000Z" });
    expect(await recordGardenVisit()).toEqual({ started: true });
    expect(saveGardenVisit).toHaveBeenCalledWith(expect.objectContaining({ seenBefore: "2026-10-01T00:00:00.000Z" }));
  });
});

// The Maybe? pile (decision 025): Keep → on the shelf; Not a tip → gone. Each tap is also a label for the sorter.
describe.each([["keepTip", keepTip, "kept"], ["notATip", notATip, "not_a_tip"]] as const)("%s", (_name, action, verdict) => {
  it("refuses anyone but the owner, without touching the tip", async () => {
    signedInAs("user_stranger");
    await expect(action(7)).rejects.toThrow(/not found/i);
    signedInAs(null);
    await expect(action(7)).rejects.toThrow(/not found/i);
    expect(setTipVerdict).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, Number.NaN, Number.MAX_VALUE, "7", null, undefined])("rejects the id %s without a write", async (id) => {
    signedInAs("user_owner");
    await expect(action(id as never)).rejects.toThrow(/invalid tip/i);
    expect(setTipVerdict).not.toHaveBeenCalled();
  });

  it(`records "${verdict}" and refreshes the garden's pages`, async () => {
    signedInAs("user_owner");
    expect(await action(7)).toEqual({ changed: true });
    expect(setTipVerdict).toHaveBeenCalledWith(7, verdict, { defer: after }); // Bee never holds up the tap
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("reports a no-op when the tip was no longer a maybe", async () => {
    signedInAs("user_owner");
    vi.mocked(setTipVerdict).mockResolvedValueOnce(false);
    expect(await action(7)).toEqual({ changed: false });
  });
});

// Backlinks (M4-T6). Server actions are public endpoints: owner first, then the payload, before any write.
const related = { fromType: "idea", fromId: 1, toType: "idea", toId: 2, kind: "related" } as const;
const fits = { fromType: "rec", fromId: 9, toType: "idea", toId: 2, kind: "fits" } as const;
const sameIdea = { fromType: "idea", fromId: 1, toType: "idea", toId: 2, kind: "merge_suggestion" } as const;

describe.each([["acceptLink", acceptLink, "accepted"], ["removeLink", removeLink, "removed"]] as const)("%s", (_name, action, status) => {
  it("refuses anyone but the owner, without a write", async () => {
    signedInAs("user_stranger");
    await expect(action(related)).rejects.toThrow(/not found/i);
    expect(setLinkStatus).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing field", { ...related, toId: undefined }],
    ["a string id", { ...related, fromId: "1" }],
    ["a zero id", { ...related, fromId: 0 }],
    ["an unsafe id", { ...related, toId: Number.MAX_VALUE }],
    ["an unknown kind", { ...related, kind: "source" }],
    ["a tip on the idea side of related", { ...related, fromType: "rec" }],
    ["an idea as the source of fits", { ...fits, fromType: "idea" }],
    ["an extra field", { ...related, status: "accepted" }],
    ["null", null],
  ])("rejects %s without a write", async (_label, payload) => {
    signedInAs("user_owner");
    await expect(action(payload as never)).rejects.toThrow(/invalid link/i);
    expect(setLinkStatus).not.toHaveBeenCalled();
  });

  it.each([["related", related], ["fits", fits]])(`sets a %s link ${status} and refreshes the pages`, async (_k, payload) => {
    signedInAs("user_owner");
    expect(await action(payload as never)).toEqual({ changed: true });
    expect(setLinkStatus).toHaveBeenCalledWith(payload, status);
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });
});

describe("acceptLink on a merge suggestion", () => {
  it("is refused: accepting \"same idea\" is the merge itself, which has its own confirmed action", async () => {
    signedInAs("user_owner");
    await expect(acceptLink(sameIdea)).rejects.toThrow(/invalid link/i);
    expect(setLinkStatus).not.toHaveBeenCalled();
  });

  it("removeLink accepts it: \"not the same idea\" is a plain remove", async () => {
    signedInAs("user_owner");
    expect(await removeLink(sameIdea)).toEqual({ changed: true });
  });
});

describe("mergeIdeas", () => {
  it("refuses anyone but the owner", async () => {
    signedInAs("user_stranger");
    await expect(mergeIdeas(1, 2)).rejects.toThrow(/not found/i);
    expect(mergeClusters).not.toHaveBeenCalled();
  });

  it.each([[0, 2], [1, -2], [1.5, 2], ["1", 2], [3, 3], [null, 2]])("rejects keep %s / merged %s without a write", async (keep, merged) => {
    signedInAs("user_owner");
    await expect(mergeIdeas(keep as never, merged as never)).rejects.toThrow(/invalid idea/i);
    expect(mergeClusters).not.toHaveBeenCalled();
  });

  it("merges and returns the merge id for Undo", async () => {
    signedInAs("user_owner");
    expect(await mergeIdeas(1, 2)).toEqual({ mergeId: 41 });
    expect(mergeClusters).toHaveBeenCalledWith(1, 2);
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("a merge that changed nothing (an idea changed since the page loaded) says so, never \"Merged\"", async () => {
    signedInAs("user_owner");
    vi.mocked(mergeClusters).mockResolvedValueOnce(null);
    expect(await mergeIdeas(1, 2)).toEqual({ mergeId: null, refused: "That idea changed — try again." });
  });

  it("says why when legacy timeline lines can't be told apart, instead of failing blind", async () => {
    signedInAs("user_owner");
    const { TimelineAmbiguousError } = await import("../../../agent/lib/ideas/timeline-match");
    vi.mocked(mergeClusters).mockRejectedValueOnce(new TimelineAmbiguousError(2));
    expect(await mergeIdeas(1, 2)).toEqual({ mergeId: null, refused: "idea 2: two timeline lines share this moment; can't tell which is this mention" });
  });
});

describe("undoIdeaMerge", () => {
  it("refuses anyone but the owner, and bad ids", async () => {
    signedInAs("user_stranger");
    await expect(undoIdeaMerge(4)).rejects.toThrow(/not found/i);
    signedInAs("user_owner");
    await expect(undoIdeaMerge(-4 as never)).rejects.toThrow(/invalid merge/i);
    expect(undoMerge).not.toHaveBeenCalled();
  });

  it("undoes and reports whether anything changed", async () => {
    signedInAs("user_owner");
    expect(await undoIdeaMerge(4)).toEqual({ changed: true });
    expect(undoMerge).toHaveBeenCalledWith(4);
  });

  it("says why when nothing was undone", async () => {
    signedInAs("user_owner");
    vi.mocked(undoMerge).mockResolvedValueOnce(false);
    expect(await undoIdeaMerge(4)).toEqual({
      changed: false,
      refused: "This merge can’t be undone now: it was already undone, or one of its ideas changed or was forgotten.",
    });
  });
});
