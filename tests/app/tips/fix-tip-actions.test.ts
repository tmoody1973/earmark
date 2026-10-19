import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../../../agent/lib/recs/fix-tip", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../agent/lib/recs/fix-tip")>()),
  applyTipFix: vi.fn(async () => ({ changed: true, requeued: true })),
}));

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { applyTipFix } from "../../../agent/lib/recs/fix-tip";
import { fixTip } from "../../../app/tips/[id]/actions";

const signedInAs = (userId: string | null) => vi.mocked(auth).mockResolvedValue({ userId } as never);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.EARMARK_OWNER_CLERK_ID = "user_owner";
});

// Decision 049. A public endpoint like the others in the file: owner first, then every input, before any read or write.
describe("Fix this tip action", () => {
  it("refuses anyone but the owner, touching nothing", async () => {
    signedInAs("user_stranger");
    await expect(fixTip(7, { name: "Sun Ra" })).rejects.toThrow(/not found/i);
    signedInAs(null);
    await expect(fixTip(7, { name: "Sun Ra" })).rejects.toThrow(/not found/i);
    expect(applyTipFix).not.toHaveBeenCalled();
  });

  it.each([[0, { name: "Sun Ra" }], [-1, { name: "Sun Ra" }], [1.5, { name: "Sun Ra" }], ["7", { name: "Sun Ra" }],
    [7, {}], [7, { name: "" }], [7, { type: "poem" }], [7, { note: "x".repeat(281) }], [7, null], [7, { excerpt: "new quote" }]])(
    "rejects a bad tip id or fix (%s, %j)", async (id, fix) => {
      signedInAs("user_owner");
      await expect(fixTip(id as number, fix as never)).rejects.toThrow(/invalid/i);
      expect(applyTipFix).not.toHaveBeenCalled();
    });

  it("saves the trimmed fix and refreshes the tip page and the shelf", async () => {
    signedInAs("user_owner");
    expect(await fixTip(7, { name: " Sun Ra ", creator: "", type: "artist" })).toEqual({ changed: true, requeued: true });
    expect(applyTipFix).toHaveBeenCalledWith(7, { name: "Sun Ra", creator: null, type: "artist" });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("a tip that was cleared or changed meanwhile is said in words, not thrown", async () => {
    signedInAs("user_owner");
    vi.mocked(applyTipFix).mockResolvedValueOnce({ changed: false, requeued: false });
    expect(await fixTip(7, { note: "On Sun Ra's label." })).toEqual({ refused: expect.stringMatching(/reload/i) });
  });
});
