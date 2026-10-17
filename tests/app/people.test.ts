import { beforeEach, describe, expect, it, vi } from "vitest";

// The people pages check the owner themselves, next to the data, not only in proxy.ts (as the garden does).
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  usePathname: vi.fn(() => "/people"),
}));
vi.mock("../../agent/lib/garden/queries", () => ({
  getTasteLedger: vi.fn(async () => ({ people: [], unknown: 0 })),
  getRecommenderPage: vi.fn(async () => null),
}));

import { auth } from "@clerk/nextjs/server";
import { getRecommenderPage, getTasteLedger } from "../../agent/lib/garden/queries";
import PersonPage from "../../app/people/[id]/page";
import PeoplePage from "../../app/people/page";

const signedInAs = (userId: string | null) => vi.mocked(auth).mockResolvedValue({ userId } as never);
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.EARMARK_OWNER_CLERK_ID = "user_owner";
});

describe("people pages owner guard", () => {
  it.each([["a signed-in stranger", "user_stranger"], ["a signed-out visitor", null]])(
    "refuse %s with notFound before reading any data",
    async (_label, userId) => {
      signedInAs(userId);
      await expect(PeoplePage()).rejects.toThrow("NEXT_NOT_FOUND");
      await expect(PersonPage(params("3"))).rejects.toThrow("NEXT_NOT_FOUND");
      expect(getTasteLedger).not.toHaveBeenCalled();
      expect(getRecommenderPage).not.toHaveBeenCalled();
    },
  );

  it.each(["0", "-1", "1.5", "abc", "99999999999999999999"])("a person id of %s is a 404 without a query", async (id) => {
    signedInAs("user_owner");
    await expect(PersonPage(params(id))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(getRecommenderPage).not.toHaveBeenCalled();
  });

  it("a person with no page (unknown, owner, nothing visible) is a 404", async () => {
    signedInAs("user_owner");
    await expect(PersonPage(params("42"))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(getRecommenderPage).toHaveBeenCalledWith(42);
  });

  it("the owner gets the ledger; on day one it explains itself instead of showing anyone", async () => {
    signedInAs("user_owner");
    const tree = JSON.stringify(await PeoplePage());
    expect(getTasteLedger).toHaveBeenCalledOnce();
    expect(tree).toContain("No one here yet");
    expect(tree).not.toContain("ledger-row");
  });

  it("with only unnamed tips, it still explains itself and keeps the 'not sure who' count", async () => {
    signedInAs("user_owner");
    vi.mocked(getTasteLedger).mockResolvedValueOnce({ people: [], unknown: 2 });
    const tree = JSON.stringify(await PeoplePage());
    expect(tree).toContain("No one here yet");
    expect(tree).toContain('"count":2');
  });
});
