import { beforeEach, describe, expect, it, vi } from "vitest";

// Defence in depth: the garden page checks the owner itself, next to the data, not only in proxy.ts.
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("../../agent/lib/store/garden", () => ({ listGardenItems: vi.fn(async () => []) }));

import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { listGardenItems } from "../../agent/lib/store/garden";
import Garden from "../../app/page";

const signedInAs = (userId: string | null) => vi.mocked(auth).mockResolvedValue({ userId } as never);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.EARMARK_OWNER_CLERK_ID = "user_owner";
});

describe("garden page owner guard", () => {
  it.each([["a signed-in stranger", "user_stranger"], ["a signed-out visitor", null]])(
    "refuses %s with notFound before reading any data",
    async (_label, userId) => {
      signedInAs(userId);
      await expect(Garden()).rejects.toThrow("NEXT_NOT_FOUND");
      expect(notFound).toHaveBeenCalled();
      expect(listGardenItems).not.toHaveBeenCalled();
    },
  );

  it("refuses everyone when no owner is configured", async () => {
    delete process.env.EARMARK_OWNER_CLERK_ID;
    signedInAs("user_owner");
    await expect(Garden()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(listGardenItems).not.toHaveBeenCalled();
  });

  it("reads the garden for the owner", async () => {
    signedInAs("user_owner");
    await Garden();
    expect(listGardenItems).toHaveBeenCalledWith(50);
    expect(notFound).not.toHaveBeenCalled();
  });
});
