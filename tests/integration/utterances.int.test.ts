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
  const expire = async (ids: number[]) => {
    const { db } = await mods();
    await db()`update utterance_buffer set claimed_at = now() - interval '16 minutes' where id = any(${ids}::bigint[])`;
  };

  afterAll(async () => {
    const { db } = await mods();
    await db()`delete from utterance_buffer where conversation_uuid like ${`it-live-%-${RUN}%`}`;
    await db()`delete from bee_conversation_map where conversation_uuid like ${`it-live-%-${RUN}%`}`;
    await db()`delete from processed_conversations where bee_conversation_id = ${9_300_000_000 + RUN}`;
  });

  it("claims nothing until 4 are open, then exactly those 4 (non-overlapping windows), storing the stream's spoken_at", async () => {
    const { claimUtterances, bufferUtterance } = await mods();
    await buffer(UUID, "u1", "u2", "u3");
    expect(await claimUtterances(UUID)).toBeNull();
    await bufferUtterance(UUID, "Unknown", "u4", new Date("2026-10-16T18:05:13.000Z"));
    const first = await claimUtterances(UUID);
    expect(texts(first!.rows)).toEqual(["u1", "u2", "u3", "u4"]);
    expect(first!.claimed).toEqual(first!.rows.map((r) => r.id));
    expect(first!.rows[3]!.spokenAt).toEqual(new Date("2026-10-16T18:05:13.000Z"));
    expect(first!.rows[0]!.spokenAt).toBeNull();
    await buffer(UUID, "u5", "u6", "u7");
    expect(await claimUtterances(UUID)).toBeNull(); // 3 open < 4
    await buffer(UUID, "u8");
    expect(texts((await claimUtterances(UUID))!.rows)).toEqual(["u5", "u6", "u7", "u8"]);
  });

  it("overlapping deliveries never claim the same utterances: of five concurrent callers at most one wins, and a follow-up claim gets anything left", async () => {
    const { claimUtterances } = await mods();
    await buffer(UUID, "u9", "u10", "u11", "u12");
    const results = await Promise.all(Array.from({ length: 5 }, () => claimUtterances(UUID)));
    const winners = results.filter((r) => r !== null);
    expect(winners.length).toBeLessThanOrEqual(1); // SKIP LOCKED: callers that each saw part of the rows all back off
    if (winners.length === 0) {
      const late = await claimUtterances(UUID);
      expect(texts(late!.rows)).toEqual(["u9", "u10", "u11", "u12"]);
    } else {
      expect(texts(winners[0]!.rows)).toEqual(["u9", "u10", "u11", "u12"]);
    }
    await buffer(UUID, "u13", "u14", "u15", "u16");
    expect(texts((await claimUtterances(UUID))!.rows)).toEqual(["u13", "u14", "u15", "u16"]);
  });

  it("an unfinished claim is re-taken only after its lease; a finished (done) one never", async () => {
    const { claimUtterances, db, finishUtterancesQuery } = await mods();
    const uuid = `it-live-lease-${RUN}`;
    await buffer(uuid, "a", "b", "c", "d");
    const c = await claimUtterances(uuid);
    expect(c!.claimed).toHaveLength(4);
    expect(await claimUtterances(uuid)).toBeNull(); // in progress
    await expire(c!.claimed);
    const retaken = await claimUtterances(uuid);
    expect(retaken!.claimed).toEqual(c!.claimed); // crashed run: retried once the lease ran out
    await db().transaction((txn) => [finishUtterancesQuery(txn, retaken!.claimed)]);
    await expire(c!.claimed);
    expect(await claimUtterances(uuid)).toBeNull(); // done: never again
  });

  it("a non-contiguous retake (a stale claim plus new utterances) gets every row from the first claimed to the last", async () => {
    const { claimUtterances, db, finishUtterancesQuery } = await mods();
    const uuid = `it-live-gap-${RUN}`;
    await buffer(uuid, "g1", "g2", "g3", "g4");
    const stale = await claimUtterances(uuid); // its run crashed
    await buffer(uuid, "g5", "g6", "g7", "g8");
    // g5..g8 claimed and finished by another delivery while g1..g4 still sat under the live lease
    const mid = await claimUtterances(uuid);
    expect(texts(mid!.rows)).toEqual(["g5", "g6", "g7", "g8"]);
    await db().transaction((txn) => [finishUtterancesQuery(txn, mid!.claimed)]);
    await expire(stale!.claimed);
    await buffer(uuid, "g9", "g10", "g11", "g12");
    const retake = await claimUtterances(uuid);
    expect(retake!.claimed).toEqual([...stale!.claimed, ...retake!.claimed.slice(4)]);
    expect(texts(retake!.rows)).toEqual(["g1", "g2", "g3", "g4", "g5", "g6", "g7", "g8", "g9", "g10", "g11", "g12"]);
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
