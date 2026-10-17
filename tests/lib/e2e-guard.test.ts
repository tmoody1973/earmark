import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeMockDb } from "../helpers/mock-db";

const h = vi.hoisted(() => ({ mock: undefined as unknown as ReturnType<typeof import("../helpers/mock-db").makeMockDb> }));
vi.mock("../../agent/lib/db", () => ({ db: () => h.mock.sql }));

import { assertE2eDatabase, gardenReadOnly } from "../../agent/lib/e2e-guard";
import { markIdeaViewed, saveGardenVisit } from "../../agent/lib/garden/queries";

const TEST = "postgres://test-branch";
const PROD = "postgres://production";

describe("assertE2eDatabase (instrumentation.ts, at server start)", () => {
  it("refuses an e2e server that would write a database other than the test branch", () => {
    expect(() => assertE2eDatabase({ EARMARK_E2E: "1", DATABASE_URL: PROD, TEST_DATABASE_URL: TEST })).toThrow(/test branch/);
    expect(() => assertE2eDatabase({ EARMARK_E2E: "1", DATABASE_URL: PROD })).toThrow(/test branch/);
  });
  it("allows an e2e server on the test branch, a read-only e2e server on real data, and every non-e2e server", () => {
    expect(() => assertE2eDatabase({ EARMARK_E2E: "1", DATABASE_URL: TEST, TEST_DATABASE_URL: TEST })).not.toThrow();
    expect(() => assertE2eDatabase({ EARMARK_E2E: "1", GARDEN_READ_ONLY: "1", DATABASE_URL: PROD, TEST_DATABASE_URL: TEST })).not.toThrow();
    expect(() => assertE2eDatabase({ DATABASE_URL: PROD, TEST_DATABASE_URL: TEST })).not.toThrow();
  });
});

describe("GARDEN_READ_ONLY: garden writes become no-ops", () => {
  beforeEach(() => {
    h.mock = makeMockDb();
    delete process.env.GARDEN_READ_ONLY;
  });

  it("reads the flag", () => {
    expect(gardenReadOnly({ GARDEN_READ_ONLY: "1" })).toBe(true);
    expect(gardenReadOnly({})).toBe(false);
  });

  it("recording a visit and marking an idea viewed touch nothing", async () => {
    process.env.GARDEN_READ_ONLY = "1";
    await saveGardenVisit({ seenBefore: null, lastVisit: "2026-10-20T18:00:00.000Z" });
    await markIdeaViewed(4);
    expect(h.mock.calls).toHaveLength(0);
    delete process.env.GARDEN_READ_ONLY;
  });

  it("without the flag they write as usual", async () => {
    await saveGardenVisit({ seenBefore: null, lastVisit: "2026-10-20T18:00:00.000Z" });
    await markIdeaViewed(4);
    expect(h.mock.calls.map((c) => c.text.trim().split(" ")[0])).toEqual(["insert", "update"]);
  });
});
