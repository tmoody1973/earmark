import { afterAll, describe, expect, it } from "vitest";

// Real Neon test on the `test` branch: needs TEST_DATABASE_URL (never production). Skipped when absent.
// Run: pnpm test:int
const TEST_ID = 9_000_000_000 + (Date.now() % 1_000_000_000);
const TEST_NAME = `ZzT11Test${TEST_ID}`;

describe.skipIf(!process.env.TEST_DATABASE_URL)("conversation claim and all-or-nothing save (real Neon)", () => {
  afterAll(async () => {
    const { db } = await import("../../agent/lib/db");
    const sql = db();
    await sql`delete from recommendations where bee_conversation_id = ${TEST_ID}`;
    await sql`delete from idea_clusters where id in (select cluster_id from idea_mentions where bee_conversation_id = ${TEST_ID})`;
    await sql`delete from recommenders where first_name_key = ${TEST_NAME.toLowerCase()}`;
    await sql`delete from processed_conversations where bee_conversation_id = ${TEST_ID}`;
  });

  it("claims an unused id once, refuses the second claim, and can release it", async () => {
    const { isConversationProcessed, markConversationProcessed, releaseConversation } = await import(
      "../../agent/lib/store/conversations"
    );
    expect(await isConversationProcessed(TEST_ID)).toBe(false);
    expect(await markConversationProcessed(TEST_ID, { ideas: 0, recs: 0 })).toBe(true);
    expect(await markConversationProcessed(TEST_ID, { ideas: 0, recs: 0 })).toBe(false);
    expect(await isConversationProcessed(TEST_ID)).toBe(true);
    await releaseConversation(TEST_ID);
    expect(await isConversationProcessed(TEST_ID)).toBe(false);
  });

  it("two concurrent claims produce exactly one winner", async () => {
    const { markConversationProcessed, releaseConversation } = await import("../../agent/lib/store/conversations");
    const id = TEST_ID + 1;
    try {
      const results = await Promise.all([
        markConversationProcessed(id, { ideas: 0, recs: 0 }),
        markConversationProcessed(id, { ideas: 0, recs: 0 }),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
    } finally {
      await releaseConversation(id);
    }
  });

  it("lease: a stale unfinished claim can be re-taken; a fresh or done claim cannot", async () => {
    const { conversationCountsQuery, isConversationProcessed, markConversationProcessed, releaseConversation } = await import(
      "../../agent/lib/store/conversations"
    );
    const { db } = await import("../../agent/lib/db");
    const sql = db();
    const id = TEST_ID + 2;
    const age = () => sql`update processed_conversations set processed_at = now() - interval '20 minutes' where bee_conversation_id = ${id}`;
    try {
      expect(await markConversationProcessed(id, { ideas: 0, recs: 0 })).toBe(true);
      await age(); // the run that claimed it crashed or timed out 20 minutes ago
      expect(await isConversationProcessed(id)).toBe(false);
      expect(await markConversationProcessed(id, { ideas: 0, recs: 0 })).toBe(true); // re-taken
      expect(await markConversationProcessed(id, { ideas: 0, recs: 0 })).toBe(false); // fresh again
      await sql.transaction((txn) => [conversationCountsQuery(txn, id, { ideas: 1, recs: 2 })]);
      await age();
      const [row] = await sql`select done, idea_count, rec_count from processed_conversations where bee_conversation_id = ${id}`;
      expect(row).toMatchObject({ done: true, idea_count: 1, rec_count: 2 });
      expect(await isConversationProcessed(id)).toBe(true);
      expect(await markConversationProcessed(id, { ideas: 0, recs: 0 })).toBe(false); // done is final
    } finally {
      await releaseConversation(id);
    }
  });

  it("pruneUtteranceBuffer deletes utterances older than 6 hours and keeps recent ones", async () => {
    const { pruneUtteranceBuffer } = await import("../../agent/lib/store/conversations");
    const { db } = await import("../../agent/lib/db");
    const sql = db();
    const uuid = `zz-prune-${TEST_ID}`;
    try {
      await sql`insert into utterance_buffer (conversation_uuid, speaker, text, received_at)
                values (${uuid}, 'Unknown', 'old', now() - interval '7 hours'), (${uuid}, 'Unknown', 'new', now() - interval '5 hours')`;
      await pruneUtteranceBuffer();
      const left = await sql`select text from utterance_buffer where conversation_uuid = ${uuid}`;
      expect(left.map((r) => r.text)).toEqual(["new"]);
    } finally {
      await sql`delete from utterance_buffer where conversation_uuid = ${uuid}`;
    }
  });

  const rec = {
    kind: "rec" as const, route: "accept" as const, recType: "place" as const, beeConversationId: TEST_ID, beeJournalId: null,
    spokenAt: new Date("2026-10-16T12:00:00Z"), confidence: 0.9, source: "ambient" as const,
    extraction: { canonicalName: "Ardent T11", creator: null, recommenderName: TEST_NAME, excerpt: "you have to try Ardent" },
    attribution: { firstName: TEST_NAME, source: "second_person" as const },
  };

  it("saves a rec with its recommender, and an idea, through the real SQL", async () => {
    const { saveAcceptedItem } = await import("../../agent/lib/pipeline/save-item");
    const { db } = await import("../../agent/lib/db");
    const r = await saveAcceptedItem(rec);
    expect(r.kind).toBe("rec");
    await saveAcceptedItem(rec); // second rec by same person upserts the recommender
    const [who] = await db()`select recs_given from recommenders where first_name_key = ${TEST_NAME.toLowerCase()}`;
    expect(Number(who!.recs_given)).toBe(2);
    const i = await saveAcceptedItem({ ...rec, kind: "idea", extraction: { title: "T11 idea", excerpt: "what if we did" } } as never);
    expect(i.kind).toBe("idea");
  });

  it("a failing statement in the transaction leaves zero rows", async () => {
    const { buildSaveQueries } = await import("../../agent/lib/pipeline/save-item");
    const { db } = await import("../../agent/lib/db");
    const sql = db();
    const before = await sql`select count(*)::int as n from recommendations where bee_conversation_id = ${TEST_ID}`;
    await expect(
      sql.transaction((txn) => [
        ...buildSaveQueries(txn, { ...rec, extraction: { ...rec.extraction, canonicalName: "Rolled back" } }),
        txn`select 1 / 0`,
      ]),
    ).rejects.toThrow();
    const after = await sql`select count(*)::int as n from recommendations where bee_conversation_id = ${TEST_ID}`;
    expect(after[0]!.n).toBe(before[0]!.n);
    const rolled = await sql`select 1 from recommendations where canonical_name = 'Rolled back' and bee_conversation_id = ${TEST_ID}`;
    expect(rolled).toHaveLength(0);
  });
});
