import { beforeEach, describe, expect, it, vi } from "vitest";

const requireOwner = vi.fn();
vi.mock("@/app/gardeners/owner", () => ({ requireOwner: () => requireOwner() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/agent/lib/e2e-guard", () => ({ gardenReadOnly: () => false }));
vi.mock("@/agent/lib/spaces/publish", () => ({
  publishSpace: vi.fn(async () => "t"), unpublishSpace: vi.fn(async () => true),
  setIndexable: vi.fn(async () => true), setNameConsent: vi.fn(async () => true),
}));
import * as publish from "@/agent/lib/spaces/publish";
import { consentAction, indexableAction, publishAction, unpublishAction } from "@/app/spaces/[id]/publish/actions";

beforeEach(() => vi.clearAllMocks());

describe("publish actions", () => {
  it("call nothing when the caller is not the owner", async () => {
    requireOwner.mockRejectedValue(new Error("not found"));
    await expect(publishAction(1)).rejects.toThrow();
    await expect(unpublishAction(1)).rejects.toThrow();
    await expect(indexableAction(1, true)).rejects.toThrow();
    await expect(consentAction(1, 2, true)).rejects.toThrow();
    for (const fn of Object.values(publish)) expect(fn).not.toHaveBeenCalled();
  });
  it("refuse malformed ids", async () => {
    requireOwner.mockResolvedValue(undefined);
    for (const bad of [0, -1, 1.5, Number.NaN, "x" as never]) {
      await expect(publishAction(bad)).rejects.toThrow("invalid id");
      await expect(consentAction(1, bad, true)).rejects.toThrow("invalid id");
    }
    expect(publish.publishSpace).not.toHaveBeenCalled();
    expect(publish.setNameConsent).not.toHaveBeenCalled();
  });
  it("pass the Space to consent", async () => {
    requireOwner.mockResolvedValue(undefined);
    await consentAction(3, 7, true);
    expect(publish.setNameConsent).toHaveBeenCalledWith(3, 7, true);
  });
});
