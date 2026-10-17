import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(() => { throw new Error("NEXT_REDIRECT"); }) }));
vi.mock("../../../agent/lib/garden/spaces", () => ({
  createSpace: vi.fn(async () => 12),
  renameSpace: vi.fn(async () => true),
  deleteSpace: vi.fn(async () => true),
  setSpaceItemStatus: vi.fn(async () => true),
}));
vi.mock("../../../agent/lib/spaces/evaluate", () => ({ evaluateSpaces: vi.fn(async () => ({})), MAX_CALLS_PER_SPACE: 30 }));

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import * as lib from "../../../agent/lib/garden/spaces";
import { evaluateSpaces } from "../../../agent/lib/spaces/evaluate";
import { createSpace, deleteSpace, keepSpaceItem, removeSpaceItem, renameSpace } from "../../../app/garden/actions";

const signedInAs = (userId: string | null) => vi.mocked(auth).mockResolvedValue({ userId } as never);
const form = (sentence: unknown) => {
  const f = new FormData();
  if (typeof sentence === "string") f.set("sentence", sentence);
  return f;
};
const NONE = { error: null };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.EARMARK_OWNER_CLERK_ID = "user_owner";
});

describe("createSpace", () => {
  it("refuses anyone but the owner, without writing", async () => {
    signedInAs("user_stranger");
    await expect(createSpace(NONE, form("Books to give my dad"))).rejects.toThrow(/not found/i);
    signedInAs(null);
    await expect(createSpace(NONE, form("Books to give my dad"))).rejects.toThrow(/not found/i);
    expect(lib.createSpace).not.toHaveBeenCalled();
  });

  it.each([["too short", "ab"], ["blank", "   "], ["missing", undefined], ["too long", "x".repeat(201)]])(
    "says what is wrong with a %s sentence and writes nothing", async (_why, sentence) => {
      signedInAs("user_owner");
      expect(await createSpace(NONE, form(sentence))).toEqual({ error: "Describe the Space in 3 to 200 characters." });
      expect(lib.createSpace).not.toHaveBeenCalled();
    });

  it("saves the trimmed sentence, starts the first fill after the response, and opens the new Space", async () => {
    signedInAs("user_owner");
    await expect(createSpace(NONE, form("  Books to give my dad "))).rejects.toThrow("NEXT_REDIRECT");
    expect(lib.createSpace).toHaveBeenCalledWith("Books to give my dad");
    expect(redirect).toHaveBeenCalledWith("/spaces/12");
    expect(revalidatePath).toHaveBeenCalledWith("/spaces");
    // the fill is bounded to this Space's share of a run, and only runs once the page is on its way
    expect(evaluateSpaces).not.toHaveBeenCalled();
    await (vi.mocked(after).mock.calls[0][0] as () => Promise<void>)();
    expect(evaluateSpaces).toHaveBeenCalledWith({ spaceId: 12, maxCalls: 30 });
  });

  it("says so when the garden is read-only", async () => {
    signedInAs("user_owner");
    vi.mocked(lib.createSpace).mockResolvedValueOnce(null);
    expect(await createSpace(NONE, form("Books to give my dad"))).toEqual({ error: "The garden is read-only right now. Nothing was saved." });
    expect(after).not.toHaveBeenCalled();
  });
});

describe("renameSpace / deleteSpace", () => {
  it("refuse anyone but the owner", async () => {
    signedInAs("user_stranger");
    await expect(renameSpace(3, "Dad")).rejects.toThrow(/not found/i);
    await expect(deleteSpace(3)).rejects.toThrow(/not found/i);
    expect(lib.renameSpace).not.toHaveBeenCalled();
    expect(lib.deleteSpace).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "3"])("refuse the id %s", async (id) => {
    signedInAs("user_owner");
    await expect(renameSpace(id as never, "Dad")).rejects.toThrow(/invalid space id/);
    await expect(deleteSpace(id as never)).rejects.toThrow(/invalid space id/);
  });

  it("rename trims the name and refuses an empty or overlong one", async () => {
    signedInAs("user_owner");
    expect(await renameSpace(3, "  Dad’s books ")).toEqual({ changed: true });
    expect(lib.renameSpace).toHaveBeenCalledWith(3, "Dad’s books");
    await expect(renameSpace(3, "  ")).rejects.toThrow(/invalid name/);
    await expect(renameSpace(3, "x".repeat(201))).rejects.toThrow(/invalid name/);
    expect(revalidatePath).toHaveBeenCalledWith("/spaces", "layout");
  });

  it("delete reports whether the Space was there", async () => {
    signedInAs("user_owner");
    expect(await deleteSpace(3)).toEqual({ changed: true });
    vi.mocked(lib.deleteSpace).mockResolvedValueOnce(false);
    expect(await deleteSpace(3)).toEqual({ changed: false });
  });
});

describe("keepSpaceItem / removeSpaceItem", () => {
  const key = { spaceId: 3, itemType: "rec" as const, itemId: 9 };

  it("refuse anyone but the owner", async () => {
    signedInAs("user_stranger");
    await expect(keepSpaceItem(key)).rejects.toThrow(/not found/i);
    await expect(removeSpaceItem(key)).rejects.toThrow(/not found/i);
    expect(lib.setSpaceItemStatus).not.toHaveBeenCalled();
  });

  it.each([
    { ...key, itemType: "moment" },
    { ...key, spaceId: 0 },
    { ...key, itemId: "9" },
    { ...key, extra: 1 },
    null,
  ])("refuse a malformed key %j", async (bad) => {
    signedInAs("user_owner");
    await expect(keepSpaceItem(bad as never)).rejects.toThrow(/invalid space item/);
    await expect(removeSpaceItem(bad as never)).rejects.toThrow(/invalid space item/);
    expect(lib.setSpaceItemStatus).not.toHaveBeenCalled();
  });

  it("keep accepts, remove removes", async () => {
    signedInAs("user_owner");
    expect(await keepSpaceItem(key)).toEqual({ changed: true });
    expect(lib.setSpaceItemStatus).toHaveBeenLastCalledWith(key, "accepted");
    expect(await removeSpaceItem(key)).toEqual({ changed: true });
    expect(lib.setSpaceItemStatus).toHaveBeenLastCalledWith(key, "removed");
  });
});
