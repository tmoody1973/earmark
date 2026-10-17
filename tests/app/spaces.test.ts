import { beforeEach, describe, expect, it, vi } from "vitest";

// The Spaces pages check the owner themselves, next to the data, not only in proxy.ts (as People does).
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  usePathname: vi.fn(() => "/spaces"),
  useRouter: vi.fn(() => ({ refresh: vi.fn(), replace: vi.fn() })),
}));
vi.mock("../../agent/lib/garden/spaces", () => ({
  listSpaces: vi.fn(async () => []),
  getSpace: vi.fn(async () => null),
  spaceCounts: vi.fn(() => ""),
}));

import { auth } from "@clerk/nextjs/server";
import { getSpace, listSpaces } from "../../agent/lib/garden/spaces";
import SpacePage, { generateMetadata } from "../../app/spaces/[id]/page";
import SpacesPage, { maxDuration } from "../../app/spaces/page";

const signedInAs = (userId: string | null) => vi.mocked(auth).mockResolvedValue({ userId } as never);
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.EARMARK_OWNER_CLERK_ID = "user_owner";
});

describe("spaces pages owner guard", () => {
  it.each([["a signed-in stranger", "user_stranger"], ["a signed-out visitor", null]])(
    "refuse %s with notFound before reading any data",
    async (_label, userId) => {
      signedInAs(userId);
      await expect(SpacesPage()).rejects.toThrow("NEXT_NOT_FOUND");
      await expect(SpacePage(params("3"))).rejects.toThrow("NEXT_NOT_FOUND");
      expect(await generateMetadata(params("3"))).toEqual({ title: "Space · Earmark" }); // never the name
      expect(listSpaces).not.toHaveBeenCalled();
      expect(getSpace).not.toHaveBeenCalled();
    },
  );

  it.each(["0", "-1", "1.5", "abc", "99999999999999999999"])("a Space id of %s is a 404 without a query", async (id) => {
    signedInAs("user_owner");
    await expect(SpacePage(params(id))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(getSpace).not.toHaveBeenCalled();
  });

  it("a Space that does not exist is a 404", async () => {
    signedInAs("user_owner");
    await expect(SpacePage(params("42"))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(getSpace).toHaveBeenCalledWith(42);
  });

  it("with no Spaces yet, the list explains itself and offers the form", async () => {
    signedInAs("user_owner");
    const tree = JSON.stringify(await SpacesPage());
    expect(tree).toContain("No Spaces yet");
    expect(tree).toContain("every idea and tip of yours that fits");
    expect(tree).not.toContain("space-row");
  });

  it("gives the create request room for the first fill it starts in after()", () => {
    expect(maxDuration).toBe(300);
  });
});
