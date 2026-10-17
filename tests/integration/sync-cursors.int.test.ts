import { afterAll, describe, expect, it } from "vitest";

// Real Neon `test` branch (TEST_DATABASE_URL, never production).
const NAME = `zzt3-${Date.now()}`;

describe.skipIf(!process.env.TEST_DATABASE_URL)("sync cursors (real Neon)", () => {
  afterAll(async () => {
    const { db } = await import("../../agent/lib/db");
    await db()`delete from sync_cursors where name = ${NAME} or name = ${NAME + "-p"}`;
  });

  it("returns null before the first save, then upserts in place", async () => {
    const { getCursor, saveCursor } = await import("../../agent/lib/store/sync-cursors");
    expect(await getCursor(NAME)).toBeNull();
    await saveCursor(NAME, "v1-1");
    expect(await getCursor(NAME)).toBe("v1-1");
    await saveCursor(NAME, "v1-2");
    expect(await getCursor(NAME)).toBe("v1-2");
  });

  it("only moves forward, comparing the numeric tail (not the text)", async () => {
    const { getCursor, saveCursor } = await import("../../agent/lib/store/sync-cursors");
    await saveCursor(NAME, "v1-1000");
    await saveCursor(NAME, "v1-999"); // text-wise "v1-999" > "v1-1000"; numerically older
    expect(await getCursor(NAME)).toBe("v1-1000");
    await saveCursor(NAME, "v1-1000"); // equal: no-op
    await saveCursor(NAME, "v1-1001");
    expect(await getCursor(NAME)).toBe("v1-1001");
  });

  it("round-trips the pending list and overwrites it freely (it is not a monotonic cursor)", async () => {
    const { getPending, savePending, emptyPending } = await import("../../agent/lib/store/sync-cursors");
    const { db } = await import("../../agent/lib/db");
    try {
      expect(await getPending()).toEqual(emptyPending());
      const p = {
        conversations: [{ id: 1, firstSeen: "2026-10-16T00:00:00.000Z" }], journals: [{ id: "j", firstSeen: "2026-10-16T00:00:00.000Z" }],
        todos: [{ id: 10, attempts: 2 }], facts: [{ id: 7, attempts: 1 }],
      };
      await savePending(p);
      expect(await getPending()).toEqual(p);
      // A list saved before M3-T8 (no todos/facts) still reads.
      await db()`update sync_cursors set cursor = ${JSON.stringify({ conversations: [], journals: [] })} where name = 'bee_changes_pending'`;
      expect(await getPending()).toEqual(emptyPending());
      await savePending(emptyPending());
      expect(await getPending()).toEqual(emptyPending());
    } finally {
      await db()`delete from sync_cursors where name = 'bee_changes_pending'`; // a red run must not poison the next
    }
  });
});
