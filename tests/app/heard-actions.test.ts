import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("../../agent/lib/garden/queries", () => ({ setTipVerdict: vi.fn(async () => true) }));

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { setTipVerdict } from "../../agent/lib/garden/queries";
import { clearHeard, keepHeard } from "../../app/heard/actions";

const signedInAs = (userId: string | null) => vi.mocked(auth).mockResolvedValue({ userId } as never);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.EARMARK_OWNER_CLERK_ID = "user_owner";
});

// Heard nearby (decision 052): Keep → on the shelf; Clear → dismissed. Only while the tip is still overheard.
describe.each([["keepHeard", keepHeard, "kept"], ["clearHeard", clearHeard, "not_a_tip"]] as const)("%s", (_n, action, verdict) => {
  it("refuses anyone but the owner, without touching the tip", async () => {
    signedInAs("user_stranger");
    await expect(action(7)).rejects.toThrow(/not found/i);
    expect(setTipVerdict).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, Number.NaN, "7" as unknown as number])("rejects the id %s before any write", async (id) => {
    signedInAs("user_owner");
    await expect(action(id)).rejects.toThrow(/invalid tip id/);
    expect(setTipVerdict).not.toHaveBeenCalled();
  });

  it("gives the verdict on the heard pile, effects after the response, and refreshes every page", async () => {
    signedInAs("user_owner");
    expect(await action(7)).toEqual({ changed: true });
    expect(setTipVerdict).toHaveBeenCalledWith(7, verdict, { pile: "heard", defer: after });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });
});
