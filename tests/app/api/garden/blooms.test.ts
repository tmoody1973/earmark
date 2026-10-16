import { beforeEach, describe, expect, it, vi } from "vitest";

const clerk = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => clerk);
const store = vi.hoisted(() => ({
  listGardenEventsSince: vi.fn(async (_since: Date) => [
    { id: 1, kind: "bloom", clusterId: 12, title: "AI newsletter", stage: "ready", mentionCount: 3, createdAt: "2026-10-17T15:00:06.000Z" },
  ]),
}));
vi.mock("../../../../agent/lib/store/garden-events", () => store);

import { GET } from "../../../../app/api/garden/blooms/route";

const get = (qs = "") => GET(new Request(`https://x.test/api/garden/blooms${qs}`));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.EARMARK_OWNER_CLERK_ID = "user_owner"; // isOwner reads it at call time
});

describe("GET /api/garden/blooms", () => {
  it.each([["a signed-in stranger", "user_stranger"], ["a signed-out visitor", null]])(
    "is a 404 for %s (like the garden page), before reading any data",
    async (_label, userId) => {
      clerk.auth.mockResolvedValue({ userId });
      expect((await get("?since=2026-10-17T15:00:00.000Z")).status).toBe(404);
      expect(store.listGardenEventsSince).not.toHaveBeenCalled();
    },
  );

  it.each(["", "?since=yesterday", "?since=1", "?since=2026-10-17", "?since=2026-13-40T99:00:00Z"])("rejects a missing or non-ISO since (%s) with 400", async (qs) => {
    clerk.auth.mockResolvedValue({ userId: "user_owner" });
    expect((await get(qs)).status).toBe(400);
    expect(store.listGardenEventsSince).not.toHaveBeenCalled();
  });

  it("returns events after since plus a slightly-behind server now, uncached", async () => {
    clerk.auth.mockResolvedValue({ userId: "user_owner" });
    const before = Date.now();
    const res = await get("?since=2026-10-17T15:00:00.000Z");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.events[0]).toMatchObject({ id: 1, kind: "bloom", title: "AI newsletter", mentionCount: 3 });
    expect(store.listGardenEventsSince).toHaveBeenCalledWith(new Date("2026-10-17T15:00:00.000Z"));
    // A save that started before this poll may commit after it: the next poll re-reads a short overlap (client dedupes by id).
    expect(new Date(body.now).getTime()).toBeLessThanOrEqual(before);
    expect(new Date(body.now).getTime()).toBeGreaterThan(before - 60_000);
  });

  it("accepts an offset ISO time", async () => {
    clerk.auth.mockResolvedValue({ userId: "user_owner" });
    expect((await get(`?since=${encodeURIComponent("2026-10-17T10:00:00-05:00")}`)).status).toBe(200);
  });
});
