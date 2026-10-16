import { afterAll, describe, expect, it } from "vitest";

// Real Neon `test` branch (TEST_DATABASE_URL, never production).
const NAME = `zzt3-${Date.now()}`;

describe.skipIf(!process.env.TEST_DATABASE_URL)("sync cursors (real Neon)", () => {
  afterAll(async () => {
    const { db } = await import("../../agent/lib/db");
    await db()`delete from sync_cursors where name = ${NAME}`;
  });

  it("returns null before the first save, then upserts in place", async () => {
    const { getCursor, saveCursor } = await import("../../agent/lib/store/sync-cursors");
    expect(await getCursor(NAME)).toBeNull();
    await saveCursor(NAME, "v1-1");
    expect(await getCursor(NAME)).toBe("v1-1");
    await saveCursor(NAME, "v1-2");
    expect(await getCursor(NAME)).toBe("v1-2");
  });
});
