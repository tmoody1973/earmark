import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeMockDb } from "../../helpers/mock-db";

const h = vi.hoisted(() => ({ mock: undefined as unknown as ReturnType<typeof import("../../helpers/mock-db").makeMockDb> }));
vi.mock("../../../agent/lib/db", () => ({ db: () => h.mock.sql }));

import { buildLedger, tasteLine } from "../../../agent/lib/garden/ledger";
import { getRecommenderPage, getTasteLedger, type RecCardData } from "../../../agent/lib/garden/queries";

type Tip = Pick<RecCardData, "id" | "name" | "saidAt" | "status" | "rating" | "recommender">;
let nextId = 1;
const tip = (who: { id: number; firstName: string } | null, saidAt: string, more: Partial<Tip> = {}): RecCardData =>
  ({ id: nextId++, name: `tip ${nextId}`, saidAt, status: "new", rating: null, recommender: who, ...more }) as RecCardData;

const ann = { id: 3, firstName: "Ann" };
const sam = { id: 5, firstName: "Sam" };
const lena = { id: 9, firstName: "Lena" };

describe("buildLedger", () => {
  it("counts each person's tips, tried (status tried/thanked or any rating) and loved", () => {
    const { people } = buildLedger([
      tip(ann, "2026-10-10T00:00:00Z", { status: "tried", rating: "loved" }),
      tip(ann, "2026-10-09T00:00:00Z", { status: "thanked" }),
      tip(ann, "2026-10-08T00:00:00Z", { status: "queued", rating: "not_for_me" }),
      tip(ann, "2026-10-07T00:00:00Z", { status: "needs_review" }),
    ]);
    expect(people).toEqual([
      expect.objectContaining({ id: 3, firstName: "Ann", given: 4, tried: 3, loved: 1, lastTipAt: "2026-10-10T00:00:00Z" }),
    ]);
  });

  it("orders people by their most recent tip, newest first, whatever order the tips arrive in", () => {
    const { people } = buildLedger([
      tip(ann, "2026-10-01T00:00:00Z"),
      tip(sam, "2026-10-05T00:00:00Z"),
      tip(ann, "2026-10-03T00:00:00Z", { name: "Promises" }),
      tip(lena, "2026-10-12T00:00:00Z", { name: "Shōgun" }),
    ]);
    expect(people.map((p) => p.firstName)).toEqual(["Lena", "Sam", "Ann"]);
    expect(people[2]).toMatchObject({ latest: "Promises", lastTipAt: "2026-10-03T00:00:00Z" });
  });

  it("breaks a tie on the latest tip by first name, so the order is stable", () => {
    const at = "2026-10-05T00:00:00Z";
    expect(buildLedger([tip(sam, at), tip(ann, at)]).people.map((p) => p.firstName)).toEqual(["Ann", "Sam"]);
  });

  it("counts tips with no recommender as 'not sure who', never as a person", () => {
    const ledger = buildLedger([tip(null, "2026-10-01T00:00:00Z"), tip(null, "2026-10-02T00:00:00Z"), tip(ann, "2026-10-03T00:00:00Z")]);
    expect(ledger.unknown).toBe(2);
    expect(ledger.people.map((p) => p.id)).toEqual([3]);
  });

  it("is empty on day one", () => {
    expect(buildLedger([])).toEqual({ people: [], unknown: 0 });
  });
});

describe("tasteLine", () => {
  it("reads like the ruling's example", () => {
    expect(tasteLine({ given: 4, tried: 2, loved: 1 })).toBe("4 tips · 2 tried · loved 1");
  });
  it("uses the singular, says plainly when nothing is tried yet, and leaves out loved when there is none", () => {
    expect(tasteLine({ given: 1, tried: 0, loved: 0 })).toBe("1 tip · not tried yet");
    expect(tasteLine({ given: 3, tried: 1, loved: 0 })).toBe("3 tips · 1 tried");
  });
});

const row = (over: Record<string, unknown>) => ({
  id: 1, type: "album", canonical_name: "Promises", creator: null, year_or_address: null, image_url: null,
  context_summary: null, said_at: "2026-10-15T15:00:00Z", status: "new", rating: null, lat: null, lng: null,
  links: {}, recommender_id: 3, first_name: "Ann", ...over,
});

describe("ledger queries", () => {
  beforeEach(() => { h.mock = makeMockDb(); });
  afterEach(() => { delete process.env.EARMARK_OWNER_FIRST_NAME; });

  it("reads every visible tip (not dismissed or composted) with no row limit, and never the counter columns", async () => {
    h.mock.queue.push([row({ id: 1 }), row({ id: 2, recommender_id: null, first_name: null })]);
    const ledger = await getTasteLedger();
    expect(ledger.people).toHaveLength(1);
    expect(ledger.unknown).toBe(1);
    const text = h.mock.calls[0].text;
    expect(text).toContain("r.status not in ('dismissed','composted')");
    expect(text).not.toMatch(/\blimit\b/);
    expect(text).not.toContain("recs_");
    expect(text).not.toContain("raw_text");
    expect(text).not.toContain("excerpt");
  });

  it("never lists the garden's owner as a recommender: their tips count as 'not sure who'", async () => {
    process.env.EARMARK_OWNER_FIRST_NAME = "Tarik";
    h.mock.queue.push([row({ id: 1, recommender_id: 7, first_name: "tarik" }), row({ id: 2 })]);
    const ledger = await getTasteLedger();
    expect(ledger.people.map((p) => p.firstName)).toEqual(["Ann"]);
    expect(ledger.unknown).toBe(1);
  });

  it("builds one person's page from their visible tips, newest first", async () => {
    h.mock.queue.push([row({ id: 1, status: "tried", rating: "loved" }), row({ id: 2, said_at: "2026-10-01T00:00:00Z" })]);
    const page = await getRecommenderPage(3);
    expect(page?.person).toMatchObject({ id: 3, firstName: "Ann", given: 2, tried: 1, loved: 1 });
    expect(page?.recs.map((r) => r.id)).toEqual([1, 2]);
    expect(h.mock.calls[0].values).toContain(3);
    expect(h.mock.calls[0].text).toContain("order by r.said_at desc");
  });

  it("has no page for an unknown id, a person with no visible tips, or the owner", async () => {
    h.mock.queue.push([]);
    expect(await getRecommenderPage(42)).toBeNull();
    process.env.EARMARK_OWNER_FIRST_NAME = "Tarik";
    h.mock.queue.push([row({ recommender_id: 7, first_name: "Tarik" })]);
    expect(await getRecommenderPage(7)).toBeNull();
  });
});
