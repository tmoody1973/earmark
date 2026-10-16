import { beforeEach, describe, expect, it, vi } from "vitest";

// Defence in depth: the garden page checks the owner itself, next to the data, not only in proxy.ts.
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("../../agent/lib/garden/queries", () => ({
  getGardenView: vi.fn(async () => ({ plants: [], shelf: [], serverTime: new Date().toISOString() })),
}));

import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { getGardenView } from "../../agent/lib/garden/queries";
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
      expect(getGardenView).not.toHaveBeenCalled();
    },
  );

  it("refuses everyone when no owner is configured", async () => {
    delete process.env.EARMARK_OWNER_CLERK_ID;
    signedInAs("user_owner");
    await expect(Garden()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(getGardenView).not.toHaveBeenCalled();
  });

  it("starts the live ticker from the server's render time, so nothing between render and first poll is missed", async () => {
    signedInAs("user_owner");
    const before = Date.now();
    const tree = await Garden();
    const find = (n: unknown): { props: { since?: string } } | null => {
      if (!n || typeof n !== "object") return null;
      const el = n as { type?: { name?: string }; props?: { children?: unknown; since?: string } };
      if (el.type?.name === "BloomTicker") return el as { props: { since?: string } };
      const kids = el.props?.children;
      for (const k of Array.isArray(kids) ? kids : [kids]) {
        const hit = find(k);
        if (hit) return hit;
      }
      return null;
    };
    const since = find(tree)?.props.since;
    expect(typeof since).toBe("string");
    expect(new Date(since!).getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it("reads the garden for the owner", async () => {
    signedInAs("user_owner");
    await Garden();
    expect(getGardenView).toHaveBeenCalledOnce();
    expect(notFound).not.toHaveBeenCalled();
  });
});
