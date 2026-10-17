import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("../../../agent/lib/garden/serendipity", () => ({
  keepItem: vi.fn(async () => true),
  compostItem: vi.fn(async () => ({ changed: true, previous: "queued" })),
  undoCompost: vi.fn(async () => true),
}));

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import * as lib from "../../../agent/lib/garden/serendipity";
import { compostSerendipity, keepSerendipity, undoCompostSerendipity } from "../../../app/garden/actions";

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
    await expect(compostSerendipity(ref)).rejects.toThrow(/not found/i);
    signedInAs(null);
    await expect(undoCompostSerendipity({ ...ref, previous: "queued" })).rejects.toThrow(/not found/i);
    expect(lib.keepItem).not.toHaveBeenCalled();
    expect(lib.compostItem).not.toHaveBeenCalled();
    expect(lib.undoCompost).not.toHaveBeenCalled();
  });

  it.each([{ type: "space", id: 7 }, { type: "rec", id: 0 }, { type: "idea", id: "3" }, { ...ref, extra: 1 }, null])(
    "refuse a malformed item %j", async (bad) => {
      signedInAs("user_owner");
      await expect(keepSerendipity(bad as never)).rejects.toThrow(/invalid item/);
      await expect(compostSerendipity(bad as never)).rejects.toThrow(/invalid item/);
      expect(lib.keepItem).not.toHaveBeenCalled();
      expect(lib.compostItem).not.toHaveBeenCalled();
    });

  it.each([{ ...ref, previous: "tried" }, { ...ref }, { type: "idea", id: 3, previous: "compost" }])(
    "undo refuses %j", async (bad) => {
      signedInAs("user_owner");
      await expect(undoCompostSerendipity(bad as never)).rejects.toThrow(/invalid item/);
      expect(lib.undoCompost).not.toHaveBeenCalled();
    });

  it("keep, compost (Bee effects after the response) and undo", async () => {
    signedInAs("user_owner");
    expect(await keepSerendipity(ref)).toEqual({ changed: true });
    expect(lib.keepItem).toHaveBeenCalledWith(ref);
    expect(await compostSerendipity(ref)).toEqual({ changed: true, previous: "queued" });
    expect(lib.compostItem).toHaveBeenCalledWith(ref, { defer: after });
    expect(await undoCompostSerendipity({ type: "idea", id: 3 })).toEqual({ changed: true });
    expect(lib.undoCompost).toHaveBeenCalledWith({ type: "idea", id: 3 }, { defer: after });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });
});
