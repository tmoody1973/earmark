import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("../../../agent/lib/garden/serendipity", () => ({
  keepItem: vi.fn(async () => true),
  restIdea: vi.fn(async () => true),
  compostTip: vi.fn(async () => ({ changed: true, previous: "queued" })),
  undoCompostTip: vi.fn(async () => true),
}));

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import * as lib from "../../../agent/lib/garden/serendipity";
import { compostSerendipity, keepSerendipity, notNowSerendipity, undoCompostSerendipity } from "../../../app/garden/actions";

const signedInAs = (userId: string | null) => vi.mocked(auth).mockResolvedValue({ userId } as never);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.EARMARK_OWNER_CLERK_ID = "user_owner";
});

describe("Serendipity actions", () => {
  const ref = { type: "rec" as const, id: 7 };

  it("refuse anyone but the owner, without writing", async () => {
    signedInAs("user_stranger");
    await expect(keepSerendipity(ref)).rejects.toThrow(/not found/i);
    await expect(notNowSerendipity(3)).rejects.toThrow(/not found/i);
    await expect(compostSerendipity(7)).rejects.toThrow(/not found/i);
    signedInAs(null);
    await expect(undoCompostSerendipity({ id: 7, previous: "queued" })).rejects.toThrow(/not found/i);
    expect(lib.keepItem).not.toHaveBeenCalled();
    expect(lib.restIdea).not.toHaveBeenCalled();
    expect(lib.compostTip).not.toHaveBeenCalled();
    expect(lib.undoCompostTip).not.toHaveBeenCalled();
  });

  it.each([{ type: "space", id: 7 }, { type: "rec", id: 0 }, { type: "idea", id: "3" }, { ...ref, extra: 1 }, null])(
    "keep refuses a malformed item %j", async (bad) => {
      signedInAs("user_owner");
      await expect(keepSerendipity(bad as never)).rejects.toThrow(/invalid item/);
      expect(lib.keepItem).not.toHaveBeenCalled();
    });

  it.each([0, -1, 1.5, "3", null])("not now and compost refuse the id %j", async (bad) => {
    signedInAs("user_owner");
    await expect(notNowSerendipity(bad as never)).rejects.toThrow(/invalid item/);
    await expect(compostSerendipity(bad as never)).rejects.toThrow(/invalid item/);
    expect(lib.restIdea).not.toHaveBeenCalled();
    expect(lib.compostTip).not.toHaveBeenCalled();
  });

  it.each([{ id: 7, previous: "tried" }, { id: 7 }, { id: 7, previous: "new", type: "idea" }])("undo refuses %j", async (bad) => {
    signedInAs("user_owner");
    await expect(undoCompostSerendipity(bad as never)).rejects.toThrow(/invalid item/);
    expect(lib.undoCompostTip).not.toHaveBeenCalled();
  });

  it("keep, not now, compost (Bee effects after the response) and undo", async () => {
    signedInAs("user_owner");
    expect(await keepSerendipity(ref)).toEqual({ changed: true });
    expect(lib.keepItem).toHaveBeenCalledWith(ref);
    expect(await notNowSerendipity(3)).toEqual({ changed: true });
    expect(lib.restIdea).toHaveBeenCalledWith(3);
    expect(await compostSerendipity(7)).toEqual({ changed: true, previous: "queued" });
    expect(lib.compostTip).toHaveBeenCalledWith(7, { defer: after });
    expect(await undoCompostSerendipity({ id: 7, previous: "queued" })).toEqual({ changed: true });
    expect(lib.undoCompostTip).toHaveBeenCalledWith(7, "queued", { defer: after });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });
});
