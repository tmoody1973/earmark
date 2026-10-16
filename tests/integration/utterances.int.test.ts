import { afterAll, describe, expect, it } from "vitest";

// Real Neon test on the `test` branch: needs TEST_DATABASE_URL (never production). Skipped when absent.
const RUN = Date.now() % 1_000_000_000;
const UUID = `it-live-claim-${RUN}`;

describe.skipIf(!process.env.TEST_DATABASE_URL)("live utterance claims (done lease) on the Neon test branch", () => {
  const mods = async () => ({
    ...(await import("../../agent/lib/db")),
    ...(await import("../../agent/lib/store/conversations")),
    ...(await import("../../agent/lib/store/utterances")),
  });
  const buffer = async (uuid: string, ...texts: string[]) => {
    const { bufferUtterance } = await mods();
    for (const t of texts) await bufferUtterance(uuid, "Unknown", t);
  };
  const texts = (rows: { text: string }[]) => rows.map((r) => r.text);

  afterAll(async () => {
    const { db } = await mods();
    await db()`delete from utterance_buffer where conversation_uuid like ${`it-live-%-${RUN}%`}`;
    await db()`delete from bee_conversation_map where conversation_uuid like ${`it-live-%-${RUN}%`}`;
    await db()`delete from processed_conversations where bee_conversation_id = ${9_300_000_000 + RUN}`;
  });

  it("claims nothing until a full window (4) is buffered, then the 4; then every 2 new ones with 2 of context", async () => {
    const { claimUtterances } = await mods();
    await buffer(UUID, "u1", "u2", "u3");
    expect(await claimUtterances(UUID)).toBeNull();
    await buffer(UUID, "u4");
    const first = await claimUtterances(UUID);
    expect(texts(first!.rows)).toEqual(["u1", "u2", "u3", "u4"]);
    expect(first!.claimed).toEqual(first!.rows.map((r) => r.id));
    await buffer(UUID, "u5");
    expect(await claimUtterances(UUID)).toBeNull(); // 1 new < stride
    await buffer(UUID, "u6");
    const second = await claimUtterances(UUID);
    expect(texts(second!.rows)).toEqual(["u3", "u4", "u5", "u6"]);
    expect(second!.claimed).toHaveLength(2);
  });

  it("overlapping deliveries never claim the same utterances: of five concurrent callers exactly one wins", async () => {
    const { claimUtterances } = await mods();
    await buffer(UUID, "u7", "u8");
    const results = await Promise.all(Array.from({ length: 5 }, () => claimUtterances(UUID)));
    const winners = results.filter((r) => r !== null);
    expect(winners).toHaveLength(1);
    expect(texts(winners[0]!.rows)).toEqual(["u5", "u6", "u7", "u8"]);
  });

  it("an unfinished claim is re-taken only after its lease; a finished (done) one never", async () => {
    const { claimUtterances, db, finishUtterancesQuery } = await mods();
    await buffer(UUID, "u9", "u10");
    const c = await claimUtterances(UUID);
    expect(c!.claimed).toHaveLength(2);
    expect(await claimUtterances(UUID)).toBeNull(); // in progress
    await db()`update utterance_buffer set claimed_at = now() - interval '16 minutes' where id = any(${c!.claimed}::bigint[])`;
    const retaken = await claimUtterances(UUID);
    expect(retaken!.claimed).toEqual(c!.claimed); // crashed run: retried once the lease ran out
    await db().transaction((txn) => [finishUtterancesQuery(txn, retaken!.claimed)]);
    await db()`update utterance_buffer set claimed_at = now() - interval '16 minutes' where id = any(${c!.claimed}::bigint[])`;
    expect(await claimUtterances(UUID)).toBeNull(); // done: never again
  });

  it("prune: drops a conversation's buffer once its completed pass is done, and anything older than 6 hours", async () => {
    const { db, pruneUtteranceBuffer, rememberConversationUuid } = await mods();
    const done = `it-live-done-${RUN}`;
    const old = `it-live-old-${RUN}`;
    const fresh = `it-live-fresh-${RUN}`;
    const convId = 9_300_000_000 + RUN;
    await buffer(done, "d1");
    await buffer(old, "o1");
    await buffer(fresh, "f1");
    await db()`update utterance_buffer set received_at = now() - interval '7 hours' where conversation_uuid = ${old}`;
    await rememberConversationUuid(done, convId);
    await db()`insert into processed_conversations (bee_conversation_id, done) values (${convId}, true)`;
    await pruneUtteranceBuffer();
    const left = await db()`select conversation_uuid from utterance_buffer where conversation_uuid in (${done}, ${old}, ${fresh})`;
    expect(left.map((r) => r.conversation_uuid)).toEqual([fresh]);
  });
});
