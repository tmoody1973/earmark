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

  describe("song captures (M5-T4)", () => {
    const song = (over: Partial<CaptureRec> = {}) =>
      rec({ type: "song", canonicalName: "Zzsong Movement", creator: "Zzfloating Pts", appleMusicId: null, links: { apple_music: "https://music.apple.com/us/song/x/1550583155" },
            source: "song", confidence: 1, photo: undefined, ...over });

    it("inserts with source 'song' and the Apple Music id", async () => {
      const { saveCaptureRec } = await import("../../agent/lib/capture/save");
      const { db } = await import("../../agent/lib/db");
      const saved = await saveCaptureRec(song({ beeConversationId: CONV + 1, appleMusicId: "1550583155" }), { recentDuplicateMs: 600_000 });
      expect(saved).toMatchObject({ upgraded: false });
      expect(saved.duplicate).toBeUndefined();
      const [row] = await db()`select source, type, apple_music_id, links from recommendations where id = ${saved.id}`;
      expect(row).toMatchObject({ source: "song", type: "song", apple_music_id: "1550583155", links: { apple_music: "https://music.apple.com/us/song/x/1550583155" } });
    });

    it("a double press within 10 minutes yields one row, with or without a picked conversation", async () => {
      const { saveCaptureRec } = await import("../../agent/lib/capture/save");
      const { db } = await import("../../agent/lib/db");
      const opts = { recentDuplicateMs: 600_000 };
      const mk = () => song({ canonicalName: "Zzdouble Press", creator: "Zzdp Artist", beeConversationId: null, recommenderName: null, attributionSource: "none", evidence: [null, null] });
      const first = await saveCaptureRec(mk(), opts);
      const second = await saveCaptureRec({ ...mk(), canonicalName: "The zzdouble press" }, opts); // normalizes to the same title
      expect(second).toEqual({ id: first.id, upgraded: false, duplicate: true });
      const [{ n }] = (await db()`select count(*)::int as n from recommendations where canonical_name ilike '%zzdouble press' and source = 'song'`) as { n: number }[];
      expect(n).toBe(1);
      await db()`delete from recommendations where id = ${first.id}`;
    });

    it("two simultaneous presses of the same song save exactly one row (atomic guard)", async () => {
      const { saveCaptureRec } = await import("../../agent/lib/capture/save");
      const { db } = await import("../../agent/lib/db");
      const opts = { recentDuplicateMs: 600_000 };
      const given0 = async () => ((await db()`select coalesce(max(recs_given), 0)::int as n from recommenders where first_name_key = ${ANN.toLowerCase()}`) as { n: number }[])[0]!.n;
      await db()`delete from recommendations where canonical_name like 'Zzrace Song %'`; // leftovers of an aborted run
      const before = await given0();
      for (const conv of [null, CONV + 3]) {
        const mk = () => song({ canonicalName: `Zzrace Song ${conv ?? "none"}`, creator: "Zzrace Artist", appleMusicId: null, beeConversationId: conv, recommenderName: ANN, evidence: [`Unknown: ${ANN}, hear this`, null], attributionSource: "second_person" });
        const results = await Promise.all([saveCaptureRec(mk(), opts), saveCaptureRec(mk(), opts), saveCaptureRec(mk(), opts)]);
        const dups = results.filter((r) => r.duplicate);
        expect(dups).toHaveLength(2);
        expect(new Set(results.map((r) => r.id)).size).toBe(1);
        const [{ n }] = (await db()`select count(*)::int as n from recommendations where canonical_name = ${`Zzrace Song ${conv ?? "none"}`}`) as { n: number }[];
        expect(n).toBe(1);
      }
      // the recommender was counted once per row inserted, not once per press
      expect(await given0()).toBe(before + 2); // two rows inserted, not six presses
      await db()`delete from recommendations where canonical_name like 'Zzrace Song %'`;
    });

    it("matches a duplicate by Apple Music id even when the title was rewritten", async () => {
      const { saveCaptureRec } = await import("../../agent/lib/capture/save");
      const { db } = await import("../../agent/lib/db");
      const opts = { recentDuplicateMs: 600_000 };
      const mk = (t: string) => song({ canonicalName: t, creator: "Zzam Artist", appleMusicId: "998877", beeConversationId: null, recommenderName: null, attributionSource: "none", evidence: [null, null] });
      const first = await saveCaptureRec(mk("Zzam Original"), opts);
      await db()`update recommendations set canonical_name = 'Zzam Rewritten By Enrichment', creator = 'Someone Else' where id = ${first.id}`;
      const second = await saveCaptureRec(mk("Zzam Original"), opts);
      expect(second).toEqual({ id: first.id, upgraded: false, duplicate: true });
      await db()`delete from recommendations where id = ${first.id}`;
    });

    it("a repeated upgrade that changes nothing is reported as a duplicate", async () => {
      const { saveCaptureRec } = await import("../../agent/lib/capture/save");
      const { db } = await import("../../agent/lib/db");
      const first = await saveCaptureRec(rec({ type: "song", canonicalName: "Zznoop Song", source: "ambient", appleMusicId: null, links: {}, photo: undefined, beeConversationId: CONV + 4 }));
      const mk = () => song({ canonicalName: "Zznoop Song", beeConversationId: CONV + 4, recommenderName: null, attributionSource: "none" });
      expect(await saveCaptureRec(mk(), { recentDuplicateMs: 600_000 })).toEqual({ id: first.id, upgraded: true });
      expect(await saveCaptureRec(mk(), { recentDuplicateMs: 600_000 })).toEqual({ id: first.id, upgraded: false, duplicate: true });
      const [row] = await db()`select count(*)::int as n from recommendations where bee_conversation_id = ${CONV + 4}`;
      expect(row!.n).toBe(1);
    });

    it("does not treat a different artist, an old rec, or another source as a duplicate", async () => {
      const { saveCaptureRec } = await import("../../agent/lib/capture/save");
      const { db } = await import("../../agent/lib/db");
      const opts = { recentDuplicateMs: 600_000 };
      const base = () => song({ canonicalName: "Zzcover Tune", creator: "Zzone", beeConversationId: null, recommenderName: null, attributionSource: "none", evidence: [null, null] });
      const a = await saveCaptureRec(base(), opts);
      const b = await saveCaptureRec({ ...base(), creator: "Zztwo" }, opts);
      expect(b.id).not.toBe(a.id);
      await db()`update recommendations set created_at = now() - interval '11 minutes' where id = ${a.id}`;
      const c = await saveCaptureRec(base(), opts);
      expect(c.id).not.toBe(a.id);
      const d = await saveCaptureRec({ ...base(), source: "photo" }, opts);
      expect(d.id).not.toBe(c.id);
      await db()`delete from recommendations where id = any(${[a.id, b.id, c.id, d.id]})`;
    });

    it("upgrades an existing rec from the same picked conversation (apple_music_id filled)", async () => {
      const { saveCaptureRec } = await import("../../agent/lib/capture/save");
      const { db } = await import("../../agent/lib/db");
      const first = await saveCaptureRec(rec({ type: "song", canonicalName: "Zzupgrade Song", source: "ambient", appleMusicId: null, links: {}, photo: undefined, beeConversationId: CONV + 2 }));
      const second = await saveCaptureRec(song({ canonicalName: "zzupgrade song", appleMusicId: "1550583155", beeConversationId: CONV + 2, recommenderName: null, attributionSource: "none" }), { recentDuplicateMs: 600_000 });
      expect(second).toEqual({ id: first.id, upgraded: true });
      const rows = await db()`select source, apple_music_id from recommendations where bee_conversation_id = ${CONV + 2}`;
      expect(rows).toEqual([{ source: "ambient", apple_music_id: "1550583155" }]);
    });
  });
});
