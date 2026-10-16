import { afterAll, describe, expect, it } from "vitest";

// Real Neon test on the `test` branch (TEST_DATABASE_URL, never production). Models are stubbed; the claim, save and release SQL is real.
const JID = `zzt12-${Date.now()}`;
const NAME = "Zzquorra"; // letters only: validName rejects digits; cleaned up in afterAll
const createdAt = new Date("2026-10-16T16:00:00Z");

const fakeDeps = (kind: string, name: string | null = NAME) => ({
  triage: async () => ({ kind, kindProbability: 0.3, recType: "place", recTypeProbability: 0.7, jokingProbability: 0, broadcastProbability: 0.02, model: "m", providerMetadata: {} }),
  extractRecommendation: async () => ({ canonicalName: "Ardent T12", creator: null, recommenderName: name, excerpt: "ramen spot" }),
  extractIdea: async () => ({ title: "T12 idea", excerpt: "newsletter idea" }),
  bee: {},
  now: () => createdAt,
}) as never;

describe.skipIf(!process.env.TEST_DATABASE_URL)("processJournal (real Neon)", () => {
  afterAll(async () => {
    const { db } = await import("../../agent/lib/db");
    const sql = db();
    await sql`delete from recommendations where bee_journal_id like ${JID + "%"}`;
    await sql`delete from idea_clusters where id in (select cluster_id from idea_mentions where bee_journal_id like ${JID + "%"})`;
    await sql`delete from recommenders where first_name_key = ${NAME.toLowerCase()}`;
    await sql`delete from processed_journals where bee_journal_id like ${JID + "%"}`;
  });

  it("created then updated delivery yields exactly one rec, and the claim records it", async () => {
    const { processJournal } = await import("../../agent/lib/pipeline/process-journal");
    const { db } = await import("../../agent/lib/db");
    const j = { id: JID, text: `Earmark that, ${NAME}'s ramen spot`, createdAt };
    const first = await processJournal(j, fakeDeps("neither"));
    expect(first).toMatchObject({ created: "rec", saved: { ideaClusterIds: [], mentionIds: [] } });
    expect(await processJournal(j, fakeDeps("neither"))).toMatchObject({ created: null });
    const recs = await db()`select id, recommender_id, attribution_source, source, confidence from recommendations where bee_journal_id = ${JID}`;
    expect(recs).toHaveLength(1);
    expect(first.saved.recIds).toEqual([Number(recs[0]!.id)]); // the real Neon transaction result shape carries the id
    expect(recs[0]).toMatchObject({ attribution_source: "voice_trigger", source: "voice", confidence: 1 });
    const [claim] = await db()`select item_type, item_id from processed_journals where bee_journal_id = ${JID}`;
    expect(claim).toMatchObject({ item_type: "rec" });
    expect(Number(claim!.item_id)).toBe(Number(recs[0]!.id));
  });

  it("an unnamed voice rec has recommender null and attribution none", async () => {
    const { processJournal } = await import("../../agent/lib/pipeline/process-journal");
    const { db } = await import("../../agent/lib/db");
    const id = `${JID}-b`;
    await processJournal({ id, text: "Earmark that, the ramen spot on Brady", createdAt }, fakeDeps("neither", null));
    const [r] = await db()`select recommender_id, attribution_source from recommendations where bee_journal_id = ${id}`;
    expect(r).toMatchObject({ recommender_id: null, attribution_source: "none" });
  });

  it("a voice idea is saved and recorded; a non-trigger note is claimed as none", async () => {
    const { processJournal } = await import("../../agent/lib/pipeline/process-journal");
    const { db } = await import("../../agent/lib/db");
    const idea = `${JID}-c`;
    const saved = await processJournal({ id: idea, text: "Earmark that, newsletter idea", createdAt }, fakeDeps("idea_by_user"));
    expect(saved).toMatchObject({ created: "idea" });
    const [c] = await db()`select item_type, item_id from processed_journals where bee_journal_id = ${idea}`;
    expect(c).toMatchObject({ item_type: "idea" });
    expect(c!.item_id).not.toBeNull();
    const [m] = await db()`select id, cluster_id from idea_mentions where bee_journal_id = ${idea}`;
    expect(saved.saved).toEqual({ recIds: [], ideaClusterIds: [Number(m!.cluster_id)], mentionIds: [Number(m!.id)] });
    const none = `${JID}-d`;
    expect(await processJournal({ id: none, text: "remind me to call mom", createdAt }, fakeDeps("neither"))).toMatchObject({ created: null });
    const [n] = await db()`select item_type from processed_journals where bee_journal_id = ${none}`;
    expect(n).toMatchObject({ item_type: "none" });
  });

  it("finished claims are done: a saved voice item and a non-trigger note", async () => {
    const { db } = await import("../../agent/lib/db");
    const rows = await db()`select bee_journal_id, done from processed_journals where bee_journal_id in (${JID}, ${`${JID}-d`})`;
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.done).toBe(true);
  });

  it("lease: a stale unfinished claim can be re-taken; a done claim cannot", async () => {
    const { isJournalProcessed, markJournalProcessed, journalItemQuery } = await import("../../agent/lib/store/conversations");
    const { db } = await import("../../agent/lib/db");
    const sql = db();
    const id = `${JID}-f`;
    const age = () => sql`update processed_journals set processed_at = now() - interval '20 minutes' where bee_journal_id = ${id}`;
    expect(await markJournalProcessed(id, { type: "none", id: null })).toBe(true);
    await age();
    expect(await isJournalProcessed(id)).toBe(false);
    expect(await markJournalProcessed(id, { type: "none", id: null })).toBe(true); // re-taken
    expect(await markJournalProcessed(id, { type: "none", id: null })).toBe(false); // fresh again
    await sql.transaction((txn) => [journalItemQuery(txn, id, "rec")]);
    await age();
    expect(await isJournalProcessed(id)).toBe(true);
    expect(await markJournalProcessed(id, { type: "none", id: null })).toBe(false); // done is final
  });

  it("a failure after the claim saves nothing and releases the claim", async () => {
    const { processJournal } = await import("../../agent/lib/pipeline/process-journal");
    const { isJournalProcessed } = await import("../../agent/lib/store/conversations");
    const id = `${JID}-e`;
    const boom = { ...(fakeDeps("neither") as object), extractRecommendation: async () => { throw new Error("model down"); } } as never;
    await expect(processJournal({ id, text: "Earmark that, ramen", createdAt }, boom)).rejects.toThrow("model down");
    expect(await isJournalProcessed(id)).toBe(false);
  });
});
