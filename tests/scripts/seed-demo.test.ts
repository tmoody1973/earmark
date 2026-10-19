import { describe, expect, it } from "vitest";
import { DEMO_OWNER, IDEAS, PEOPLE, SPACES, TIPS } from "../../scripts/demo-data";
import { seedTargetProblem } from "../../scripts/seed-demo";

// The judge demo's seed (decision 053). The data is invented (people, quotes, ideas); the works and places are real.
const PROD = "postgres://u:p@ep-busy-prod-654321-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require";
const TEST = "postgres://u:p@ep-test-branch-111111.us-east-2.aws.neon.tech/neondb";
const DEMO = "postgres://owner:p@ep-quiet-demo-123456.us-east-2.aws.neon.tech/neondb";
const words = (s: string) => s.trim().split(/\s+/).length;

describe("seedTargetProblem (never seed production or TEST)", () => {
  it("needs EARMARK_DEMO_SEED_URL", () => {
    expect(seedTargetProblem(undefined, [PROD, TEST])).toMatch(/EARMARK_DEMO_SEED_URL is not set/);
    expect(seedTargetProblem("", [PROD])).toMatch(/not set/);
    expect(seedTargetProblem("mysql://x", [PROD])).toMatch(/postgres/);
  });

  it("refuses the production and TEST databases, pooled or direct, whatever the role", () => {
    expect(seedTargetProblem(PROD, [PROD, TEST])).toMatch(/production or TEST/);
    expect(seedTargetProblem(PROD.replace("-pooler", ""), [PROD, TEST])).toMatch(/production or TEST/);
    expect(seedTargetProblem(TEST.replace("u:p", "other:pw"), [PROD, TEST])).toMatch(/production or TEST/);
    expect(seedTargetProblem(DEMO, [PROD, TEST, "ep-quiet-demo-123456-pooler.us-east-2.aws.neon.tech"])).toMatch(/production or TEST/);
  });

  it("allows the demo database, ignoring unset guards", () => {
    expect(seedTargetProblem(DEMO, [PROD, TEST, undefined, ""])).toBeNull();
  });

  it("never echoes a URL or password", () => {
    expect(seedTargetProblem(PROD, [PROD])).not.toMatch(/ep-busy|u:p/);
  });
});

describe("the demo data", () => {
  it("credits about eight invented people, first names only, never the owner", () => {
    expect(PEOPLE.length).toBeGreaterThanOrEqual(8);
    for (const p of PEOPLE) expect(p).toMatch(/^[A-Z][a-z]+$/);
    expect(PEOPLE).not.toContain(DEMO_OWNER);
    expect(DEMO_OWNER).toBe("Sam");
    for (const t of TIPS) if (t.from) expect(PEOPLE).toContain(t.from);
    for (const p of PEOPLE) expect(TIPS.some((t) => t.from === p && !["needs_review", "overheard"].includes(t.status))).toBe(true);
  });

  it("has about thirty tips across every type and status", () => {
    expect(TIPS.length).toBeGreaterThanOrEqual(28);
    const types = new Set(TIPS.map((t) => t.type));
    for (const type of ["album", "song", "artist", "book", "place", "podcast", "film_tv", "video", "other"]) expect(types).toContain(type);
    const statuses = new Set(TIPS.map((t) => t.status));
    for (const s of ["new", "queued", "tried", "thanked", "needs_review", "overheard"]) expect(statuses).toContain(s);
    expect(TIPS.filter((t) => t.rating === "loved").length).toBeGreaterThanOrEqual(2);
    expect(TIPS.filter((t) => t.status === "thanked" && t.receipt).length).toBeGreaterThanOrEqual(2);
  });

  it("keeps every quote invented and within the database's 25 words", () => {
    for (const t of TIPS) expect(words(t.excerpt), t.name).toBeLessThanOrEqual(25);
    for (const i of IDEAS) for (const m of i.mentions) expect(words(m.excerpt), i.title).toBeLessThanOrEqual(25);
  });

  it("uses https art and links only", () => {
    for (const t of TIPS) {
      if (t.image) expect(t.image).toMatch(/^https:\/\//);
      for (const url of Object.values(t.links ?? {})) expect(url).toMatch(/^https:\/\//);
    }
  });

  it("asks one Which one? with 2–3 candidates, and places carry Milwaukee coordinates", () => {
    const asks = TIPS.filter((t) => t.candidates);
    expect(asks.length).toBeGreaterThanOrEqual(1);
    for (const t of asks) expect(t.candidates!.length).toBeGreaterThanOrEqual(2);
    for (const t of asks) expect(t.candidates!.length).toBeLessThanOrEqual(3);
    const mapped = TIPS.filter((t) => t.type === "place" && t.lat !== undefined);
    expect(mapped.length).toBeGreaterThanOrEqual(3);
    for (const t of mapped) {
      expect(t.lat).toBeGreaterThan(42.9);
      expect(t.lat).toBeLessThan(43.2);
      expect(t.lng).toBeGreaterThan(-88.1);
      expect(t.lng).toBeLessThan(-87.8);
    }
    expect(TIPS.some((t) => t.extras && Object.keys(t.extras).length > 0)).toBe(true);
  });

  it("grows about ten ideas, one bloomed, and two Spaces, one published", () => {
    expect(IDEAS.length).toBeGreaterThanOrEqual(9);
    expect(IDEAS.some((i) => i.stage === "drafted" && i.draft)).toBe(true);
    expect(new Set(IDEAS.map((i) => i.stage)).size).toBeGreaterThanOrEqual(4);
    expect(SPACES.length).toBeGreaterThanOrEqual(2);
    const published = SPACES.filter((s) => s.publishedToken);
    expect(published).toHaveLength(1);
    expect(published[0]!.publishedToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    for (const s of SPACES) for (const name of s.tips) expect(TIPS.map((t) => t.name)).toContain(name);
  });
});
