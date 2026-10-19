import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeMockDb } from "../../helpers/mock-db";

const h = vi.hoisted(() => ({ mock: undefined as unknown as ReturnType<typeof import("../../helpers/mock-db").makeMockDb> }));
vi.mock("../../../agent/lib/db", () => ({ db: () => h.mock.sql }));
const status = vi.hoisted(() => ({ setRecStatus: vi.fn(async () => ({ changed: true, previous: "overheard" })) }));
vi.mock("../../../agent/lib/recs/status", async (orig) => ({ ...(await orig<object>()), ...status }));

import { getHeardNearby, HEARD_DAYS, HEARD_MAX, heardMessage, heardWhen } from "../../../agent/lib/garden/heard";
import { setTipVerdict } from "../../../agent/lib/garden/queries";

// Decision 052: overheard tips nobody recommended wait in a quiet log, "Heard nearby".
describe("Heard nearby", () => {
  beforeEach(() => { h.mock = makeMockDb(); status.setRecStatus.mockClear(); });

  it("loads only overheard tips from the last 14 days, newest first, at most 50, with their stored excerpt", async () => {
    h.mock.queue.push([
      { id: 9, type: "video", canonical_name: "Hot Ones", said_at: new Date("2026-10-18T20:12:00Z"), excerpt: "new episode of Hot Ones" },
    ]);
    expect(await getHeardNearby()).toEqual([
      { id: 9, type: "video", name: "Hot Ones", heardAt: "2026-10-18T20:12:00.000Z", excerpt: "new episode of Hot Ones" },
    ]);
    const text = h.mock.calls[0]!.text.replace(/\s+/g, " ");
    expect(text).toContain("status = 'overheard'");
    expect(text).toMatch(/said_at >= now\(\) - \?::int \* interval '1 day'/);
    expect(text).toMatch(/order by said_at desc, id desc limit \?/);
    expect(h.mock.calls[0]!.values).toEqual([HEARD_DAYS, HEARD_MAX]);
    expect([HEARD_DAYS, HEARD_MAX]).toEqual([14, 50]);
    expect(text).not.toContain("raw_text");
  });

  it("says when it was heard in Chicago time", () => {
    expect(heardWhen("2026-10-18T20:12:00Z")).toBe("Heard Sun, Oct 18, 3:12 PM");
  });

  it.each([["kept", "new"], ["not_a_tip", "dismissed"]] as const)(
    "%s moves an overheard tip to %s, only while it is still overheard", async (verdict, next) => {
      expect(await setTipVerdict(9, verdict, { pile: "heard" })).toBe(true);
      expect(status.setRecStatus).toHaveBeenCalledWith(9, next, "garden", { from: ["overheard"], verdict });
    },
  );

  it("a tap's live message: kept, cleared, already handled, or failed", () => {
    expect(heardMessage("keep", "Hot Ones", { changed: true })).toBe("Kept: Hot Ones. It’s on your shelf.");
    expect(heardMessage("clear", "Hot Ones", { changed: true })).toBe("Cleared: Hot Ones");
    expect(heardMessage("keep", "Hot Ones", { changed: false })).toBe("Already handled: Hot Ones");
    expect(heardMessage("clear", "Hot Ones", null)).toBe("Couldn't save that. Hot Ones is back in the list; try again.");
  });
});
