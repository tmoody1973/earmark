import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../../../agent/lib/garden/queries", () => ({
  getGardenVisit: vi.fn(async () => null),
  saveGardenVisit: vi.fn(async () => {}),
  setTipVerdict: vi.fn(async () => true),
}));

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { getGardenVisit, saveGardenVisit, setTipVerdict } from "../../../agent/lib/garden/queries";
import { keepTip, notATip, recordGardenVisit } from "../../../app/garden/actions";

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
    expect(setTipVerdict).toHaveBeenCalledWith(7, verdict);
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("reports a no-op when the tip was no longer a maybe", async () => {
    signedInAs("user_owner");
    vi.mocked(setTipVerdict).mockResolvedValueOnce(false);
    expect(await action(7)).toEqual({ changed: false });
  });
});
