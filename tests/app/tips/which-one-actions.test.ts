import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../../../agent/lib/recs/which-one", () => ({
  pickCandidate: vi.fn(async () => ({ changed: true })),
  noneOfThese: vi.fn(async () => ({ changed: true })),
  searchAgain: vi.fn(async () => ({ status: "ok", found: 2 })),
}));

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { noneOfThese, pickCandidate, searchAgain } from "../../../agent/lib/recs/which-one";
import { chooseWhichOne, noneOfTheseTip, searchWhichOne } from "../../../app/tips/[id]/actions";

const signedInAs = (userId: string | null) => vi.mocked(auth).mockResolvedValue({ userId } as never);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.EARMARK_OWNER_CLERK_ID = "user_owner";
});

// Server actions are public endpoints (decision 048): owner first, then every input, before any read or write.
describe("Which one? actions", () => {
  it("refuse anyone but the owner, touching nothing", async () => {
    signedInAs("user_stranger");
    await expect(chooseWhichOne(7, 0, "Night Garden")).rejects.toThrow(/not found/i);
    await expect(noneOfTheseTip(7)).rejects.toThrow(/not found/i);
    await expect(searchWhichOne(7, "Night Garden")).rejects.toThrow(/not found/i);
    expect(pickCandidate).not.toHaveBeenCalled();
    expect(noneOfThese).not.toHaveBeenCalled();
    expect(searchAgain).not.toHaveBeenCalled();
  });

  it.each([[0, 0, "k"], [-1, 0, "k"], [1.5, 0, "k"], ["7", 0, "k"], [7, -1, "k"], [7, 3, "k"], [7, 0.5, "k"], [7, "1", "k"],
    [7, 0, ""], [7, 0, 4], [7, 0, "k".repeat(1001)]])(
    "reject a bad tip id, candidate index or candidate key (%s, %s, %s)", async (id, index, key) => {
      signedInAs("user_owner");
      await expect(chooseWhichOne(id as number, index as number, key as string)).rejects.toThrow(/invalid/i);
      expect(pickCandidate).not.toHaveBeenCalled();
    });

  it.each([["x"], [" a "], ["y".repeat(121)], [4]])("reject a search of the wrong length or kind (%s)", async (q) => {
    signedInAs("user_owner");
    await expect(searchWhichOne(7, q as string)).rejects.toThrow(/invalid/i);
    expect(searchAgain).not.toHaveBeenCalled();
  });

  it("pick, none and search go through, trimmed, and refresh the tip page and the shelf", async () => {
    signedInAs("user_owner");
    expect(await chooseWhichOne(7, 2, "Night Garden — Mara Vell")).toEqual({ changed: true });
    expect(pickCandidate).toHaveBeenCalledWith(7, 2, "Night Garden — Mara Vell");
    expect(await noneOfTheseTip(7)).toEqual({ changed: true });
    expect(noneOfThese).toHaveBeenCalledWith(7);
    expect(await searchWhichOne(7, "  Night Garden ")).toEqual({ found: 2 });
    expect(searchAgain).toHaveBeenCalledWith(7, "Night Garden");
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it.each([
    ["busy", /try again in a bit/i], ["too_soon", /moment/i], ["not_configured", /isn.t set up/i], ["gone", /changed/i], ["failed", /didn.t work/i],
  ] as const)("a refused search (%s) is said in words, not thrown", async (reason, words) => {
    signedInAs("user_owner");
    vi.mocked(searchAgain).mockResolvedValueOnce({ status: "refused", reason });
    const r = await searchWhichOne(7, "Night Garden");
    expect(r.refused).toMatch(words);
  });
});
