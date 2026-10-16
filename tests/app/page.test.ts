import { beforeEach, describe, expect, it, vi } from "vitest";

// Defence in depth: the garden page checks the owner itself, next to the data, not only in proxy.ts.
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("../../agent/lib/garden/queries", () => ({
  getGardenView: vi.fn(async () => ({ plants: [], shelf: [], serverTime: new Date().toISOString(), newChips: [] })),
  getGardenVisit: vi.fn(async () => null),
  saveGardenVisit: vi.fn(async () => {}),
}));

import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { getGardenView, getGardenVisit, saveGardenVisit } from "../../agent/lib/garden/queries";
import Garden from "../../app/page";

const signedInAs = (userId: string | null) => vi.mocked(auth).mockResolvedValue({ userId } as never);

// Finds a component by name in the returned element tree (server components are not rendered here).
function find(n: unknown, name: string): { props: Record<string, unknown> } | null {
  if (!n || typeof n !== "object") return null;
  const el = n as { type?: { name?: string }; props?: { children?: unknown } & Record<string, unknown> };
  if (el.type?.name === name) return el as { props: Record<string, unknown> };
  const kids = el.props?.children;
  for (const k of Array.isArray(kids) ? kids : [kids]) {
    const hit = find(k, name);
    if (hit) return hit;
  }
  return null;
}

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
      expect(getGardenVisit).not.toHaveBeenCalled();
    },
  );

  it("refuses everyone when no owner is configured", async () => {
    delete process.env.EARMARK_OWNER_CLERK_ID;
    signedInAs("user_owner");
    await expect(Garden()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(getGardenView).not.toHaveBeenCalled();
  });

  it("starts the live layer from the server's render time, so nothing between render and first poll is missed", async () => {
    signedInAs("user_owner");
    const serverTime = "2026-10-20T18:00:00.000Z";
    vi.mocked(getGardenView).mockResolvedValueOnce({ plants: [], shelf: [], serverTime, newChips: [] });
    const tree = await Garden();
    expect(find(tree, "GardenLive")?.props.initialSince).toBe(serverTime);
  });

  it("compares against the last visit, then records this one only after the render", async () => {
    signedInAs("user_owner");
    vi.mocked(getGardenVisit).mockResolvedValueOnce({ seenBefore: null, lastVisit: "2026-10-01T00:00:00.000Z" });
    await Garden();
    expect(getGardenView).toHaveBeenCalledWith("2026-10-01T00:00:00.000Z");
    expect(saveGardenVisit).not.toHaveBeenCalled();
    const job = vi.mocked(after).mock.calls[0]![0] as () => Promise<void>;
    await job();
    expect(saveGardenVisit).toHaveBeenCalledWith(expect.objectContaining({ seenBefore: "2026-10-01T00:00:00.000Z" }));
  });

  it("reads the garden for the owner", async () => {
    signedInAs("user_owner");
    await Garden();
    expect(getGardenView).toHaveBeenCalledOnce();
    expect(notFound).not.toHaveBeenCalled();
  });
});
