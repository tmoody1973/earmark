import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CaptureRec } from "../../agent/lib/capture/save";

// M5-T3 (MOO-913), real Neon `test` branch (TEST_DATABASE_URL, never production): the real SQL of saveCaptureRec.
// No model calls, no network. Names are fakes.
const RUN = Date.now() % 100_000;
const CONV = 9_700_000_000 + RUN * 10;
const OWNER = "Odette";
const ANN = "Zzcapann";
const TAKEN = new Date("2030-03-01T19:00:00Z");

const rec = (over: Partial<CaptureRec> = {}): CaptureRec => ({
  type: "album",
  rawText: "Promises · Floating Points",
  canonicalName: "Promises",
  creator: "Floating Points",
  imageUrl: null,
  links: {},
  appleMusicId: null,
  recommenderName: ANN,
  evidence: [`Unknown: ${ANN}, you have to hear Promises`, null],
  attributionSource: "second_person",
  excerpt: "you have to hear Promises",
  beeConversationId: CONV,
  saidAt: TAKEN,
  confidence: 0.9,
  source: "photo",
  photo: { takenAt: TAKEN, where: { lat: 43.04, lng: -87.91 }, conversationId: CONV, thumbnailUrl: null },
  ...over,
});

describe.skipIf(!process.env.TEST_DATABASE_URL)("saveCaptureRec (real Neon)", () => {
  let prevOwner: string | undefined;
  beforeAll(() => {
    prevOwner = process.env.EARMARK_OWNER_FIRST_NAME;
    process.env.EARMARK_OWNER_FIRST_NAME = OWNER;
  });
  afterAll(async () => {
    if (prevOwner === undefined) delete process.env.EARMARK_OWNER_FIRST_NAME;
    else process.env.EARMARK_OWNER_FIRST_NAME = prevOwner;
    const { db } = await import("../../agent/lib/db");
    const sql = db();
    await sql`delete from recommendations where bee_conversation_id between ${CONV} and ${CONV + 9}`; // photos cascade
    await sql`delete from recommenders where first_name_key = any(${[ANN.toLowerCase(), OWNER.toLowerCase()]})
              and not exists (select 1 from recommendations x where x.recommender_id = recommenders.id)`;
  });

  it("inserts the rec, the recommender and the photos row together", async () => {
    const { saveCaptureRec } = await import("../../agent/lib/capture/save");
    const { db } = await import("../../agent/lib/db");
    const saved = await saveCaptureRec(rec({ canonicalName: "Insert Path", photo: { takenAt: TAKEN, where: { lat: 43.04, lng: -87.91 }, conversationId: CONV, thumbnailUrl: "https://blob.test/t.jpg" } }));
    expect(saved.upgraded).toBe(false);
    const [row] = await db()`select r.status, r.source, r.attribution_source, r.excerpt, rc.first_name, p.thumbnail_url, p.linked_bee_conversation_id, p.lat
                             from recommendations r left join recommenders rc on rc.id = r.recommender_id
                             join photos p on p.recommendation_id = r.id where r.id = ${saved.id}`;
    expect(row).toMatchObject({ status: "new", source: "photo", attribution_source: "second_person", first_name: ANN, thumbnail_url: "https://blob.test/t.jpg", lat: 43.04 });
    expect(Number(row!.linked_bee_conversation_id)).toBe(CONV);
  });

  it("upgrades the same-conversation, same-name rec instead of inserting a second", async () => {
    const { saveCaptureRec } = await import("../../agent/lib/capture/save");
    const { db } = await import("../../agent/lib/db");
    const first = await saveCaptureRec(rec({ canonicalName: "The Upgrade Album", photo: undefined }));
    const [{ n: given }] = (await db()`select recs_given as n from recommenders where first_name_key = ${ANN.toLowerCase()}`) as { n: number }[];
    await db()`update recommendations set status = 'queued' where id = ${first.id}`;
    const second = await saveCaptureRec(rec({
      canonicalName: "upgrade album", // "The" and case normalize away
      recommenderName: null, attributionSource: "none",
      imageUrl: "https://blob.test/cover.jpg", links: { spotify: "https://s.test/x" }, appleMusicId: "am1",
      photo: { takenAt: TAKEN, where: null, conversationId: CONV, thumbnailUrl: "https://blob.test/cover.jpg" },
    }));
    expect(second).toEqual({ id: first.id, upgraded: true });
    const rows = await db()`select id, status, image_url, links, apple_music_id, recommender_id from recommendations
                            where bee_conversation_id = ${CONV} and lower(canonical_name) like '%upgrade album'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "queued", image_url: "https://blob.test/cover.jpg", apple_music_id: "am1", links: { spotify: "https://s.test/x" } });
    expect(rows[0]!.recommender_id).not.toBeNull(); // kept
    const photos = await db()`select count(*)::int as n from photos where recommendation_id = ${first.id}`;
    expect(photos[0]!.n).toBe(1);
    const [{ n: after }] = (await db()`select recs_given as n from recommenders where first_name_key = ${ANN.toLowerCase()}`) as { n: number }[];
    expect(after).toBe(given); // an upgrade is not another rec given
  });

  it("never stores the owner as a recommender", async () => {
    const { saveCaptureRec } = await import("../../agent/lib/capture/save");
    const { db } = await import("../../agent/lib/db");
    const saved = await saveCaptureRec(rec({
      canonicalName: "Owner Name Test", recommenderName: OWNER,
      evidence: [`Unknown: ${OWNER}, you have to hear this`, null],
    }));
    const [row] = await db()`select recommender_id, attribution_source from recommendations where id = ${saved.id}`;
    expect(row).toMatchObject({ recommender_id: null, attribution_source: "none" });
    const owners = await db()`select 1 from recommenders where first_name_key = ${OWNER.toLowerCase()}`;
    expect(owners).toHaveLength(0);
  });

  it("rolls the upgrade back when the photos insert fails (one transaction)", async () => {
    const { saveCaptureRec } = await import("../../agent/lib/capture/save");
    const { db } = await import("../../agent/lib/db");
    const first = await saveCaptureRec(rec({ canonicalName: "Rolled Back", photo: undefined }));
    // A conversation id Postgres cannot cast to bigint: the photos statement fails after the update has run.
    const bad = rec({ canonicalName: "Rolled Back", imageUrl: "https://blob.test/never.jpg", photo: { takenAt: TAKEN, where: null, conversationId: 1e30, thumbnailUrl: null } });
    await expect(saveCaptureRec(bad)).rejects.toThrow();
    const [row] = await db()`select image_url from recommendations where id = ${first.id}`;
    expect(row!.image_url).toBeNull();
  });
});
