import { beforeEach, describe, expect, it, vi } from "vitest";

const sql = vi.fn();
vi.mock("../../../agent/lib/db", () => ({ db: () => sql }));
import { PUBLIC_TIP_CAP, getPublishedSpace, publishSpace, rangeLabel, setNameConsent, unpublishSpace } from "../../../agent/lib/spaces/publish";

const text = (i: number) => (sql.mock.calls[i][0] as TemplateStringsArray).join("?");
const tip = (over: Record<string, unknown> = {}) => ({
  id: 4, type: "place", canonical_name: "Ramen Kyuu", creator: null, year_or_address: "1 Main St", image_url: null,
  said_at: "2026-10-02T15:00:00Z", links: null, recommender_id: 7, first_name: "Ann", consent: true, ...over,
});
beforeEach(() => sql.mockReset());

describe("publishSpace / unpublishSpace", () => {
  it("mints a 43-char token and keeps an existing one", async () => {
    sql.mockResolvedValueOnce([{ published_token: "kept" }]);
    expect(await publishSpace(1)).toBe("kept");
    expect(text(0)).toContain("coalesce(published_token");
    expect(sql.mock.calls[0].slice(1)[0]).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
  it("returns null for a missing Space", async () => {
    sql.mockResolvedValueOnce([]);
    expect(await publishSpace(99)).toBeNull();
  });
  it("unpublish clears the token", async () => {
    sql.mockResolvedValueOnce([{ id: 1 }]);
    expect(await unpublishSpace(1)).toBe(true);
    expect(text(0)).toContain("published_token = null");
  });
  it("consent off clears the timestamp", async () => {
    sql.mockResolvedValueOnce([{ id: 7 }]);
    await setNameConsent(7, false);
    expect(text(0)).toContain("public_name_consent_at");
    expect(sql.mock.calls[0].slice(1)).toEqual([null, 7]);
  });
});

describe("getPublishedSpace", () => {
  it.each(["nope", "", "a".repeat(42), "a".repeat(44), `${"a".repeat(42)}!`, `${"a".repeat(42)}=`])("rejects %j without querying", async (t) => {
    expect(await getPublishedSpace(t)).toBeNull();
    expect(sql).not.toHaveBeenCalled();
  });
  it("returns null for an unknown token", async () => {
    sql.mockResolvedValueOnce([]);
    expect(await getPublishedSpace("a".repeat(43))).toBeNull();
  });
  it("reads only accepted tips (no ideas, no hidden statuses, capped), never an excerpt", async () => {
    sql.mockResolvedValueOnce([{ id: 1, name: "Picks", rule_sentence: "Places guests love", indexable: false }]).mockResolvedValueOnce([tip()]);
    await getPublishedSpace("a".repeat(43));
    const q = text(1);
    expect(q).toContain("si.status = 'accepted'");
    expect(q).toContain("si.item_type = 'rec'");
    expect(q).not.toMatch(/excerpt|context_summary|raw_text|'idea'/);
    const params = sql.mock.calls[1].slice(1);
    expect(params).toContainEqual(["dismissed", "composted", "needs_review"]);
    expect(params).toContain(PUBLIC_TIP_CAP);
    expect(PUBLIC_TIP_CAP).toBe(40);
  });
  it("names a recommender only with consent and only if not the owner", async () => {
    sql.mockResolvedValueOnce([{ id: 1, name: "Picks", rule_sentence: "x", indexable: true }]).mockResolvedValueOnce([
      tip({ id: 1 }),
      tip({ id: 2, consent: false }),
      tip({ id: 3, recommender_id: 8, first_name: "Tarik", consent: true }),
      tip({ id: 5, recommender_id: null, first_name: null, consent: false }),
    ]);
    vi.stubEnv("EARMARK_OWNER_FIRST_NAME", "Tarik");
    const space = await getPublishedSpace("a".repeat(43));
    vi.unstubAllEnvs();
    expect(space?.indexable).toBe(true);
    expect(space?.tips.map((t) => t.recommender?.firstName ?? null)).toEqual(["Ann", null, null, null]);
  });
  it("strips anything that is someone's words or the owner's private state", async () => {
    sql.mockResolvedValueOnce([{ id: 1, name: "Picks", rule_sentence: "x", indexable: false }]).mockResolvedValueOnce([
      tip({ context_summary: "she said it was the best", rating: "loved", status: "tried" }),
    ]);
    const [t] = (await getPublishedSpace("a".repeat(43)))!.tips;
    expect(t.why).toBeNull();
    expect(t.rating).toBeNull();
    expect(t.status).toBe("new");
  });
});

describe("rangeLabel", () => {
  it("is empty with no dates, one day, or a Chicago-time range", () => {
    expect(rangeLabel([])).toBe("");
    expect(rangeLabel(["2026-10-02T15:00:00Z"])).toBe("Oct 2, 2026");
    expect(rangeLabel(["2026-10-09T15:00:00Z", "2026-10-02T15:00:00Z"])).toBe("Oct 2 – Oct 9, 2026");
    expect(rangeLabel(["2026-10-02T03:00:00Z"])).toBe("Oct 1, 2026"); // 10 pm the evening before, in Chicago
  });
});
