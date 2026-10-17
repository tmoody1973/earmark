import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("../../../agent/lib/garden/top-of-mind", () => ({ setPinned: vi.fn(async () => ({ changed: true })) }));

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { setPinned } from "../../../agent/lib/garden/top-of-mind";
import { pinIdea } from "../../../app/garden/actions";

const signedInAs = (userId: string | null) => vi.mocked(auth).mockResolvedValue({ userId } as never);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.EARMARK_OWNER_CLERK_ID = "user_owner";
});

describe("pinIdea (Top of Mind)", () => {
  it("refuses anyone but the owner, without writing", async () => {
    signedInAs("user_stranger");
    await expect(pinIdea(4, true)).rejects.toThrow(/not found/i);
    signedInAs(null);
    await expect(pinIdea(4, false)).rejects.toThrow(/not found/i);
    expect(setPinned).not.toHaveBeenCalled();
  });

  it.each([[0, true], [-1, true], [1.5, true], ["4", true], [4, "true"], [4, null]])("refuses %j / %j", async (id, pinned) => {
    signedInAs("user_owner");
    await expect(pinIdea(id as never, pinned as never)).rejects.toThrow(/invalid pin/);
    expect(setPinned).not.toHaveBeenCalled();
  });

  it("pins for the owner and refreshes every garden page", async () => {
    signedInAs("user_owner");
    expect(await pinIdea(4, true)).toEqual({ changed: true });
    expect(setPinned).toHaveBeenCalledWith(4, true);
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });
});
