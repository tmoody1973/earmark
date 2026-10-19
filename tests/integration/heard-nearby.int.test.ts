import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool, type PoolClient } from "@neondatabase/serverless";
import type { ExternalDeps } from "../../agent/lib/privacy/forget";
import type { SaveItem } from "../../agent/lib/pipeline/save-item";

// Heard nearby (decision 052) on the real Neon `test` branch (TEST_DATABASE_URL, never production); skipped when absent.
// Only this file's rows are touched (ids tracked, deleted after); every lane sweep and backfill is scoped to them.
const RUN = Date.now().toString(36);
const NAME = `IT heard ${RUN}`; // unique, so search finds only this file's tips
const ANN = `Itheard${RUN}`;

describe.skipIf(!process.env.TEST_DATABASE_URL)("Heard nearby on the Neon test branch", () => {
  let pool: Pool;
  let c: PoolClient;
  const ids: number[] = [];
  const quiet = { summarize: vi.fn(async () => null), beeSummary: vi.fn(async () => null), embedRecs: vi.fn(async () => 0),
    about: vi.fn(async () => null), extras: vi.fn(async () => ({})) };
  const enrich = vi.fn(async () => null);
  const pick = vi.fn(async () => null);
  const sweep = async (id: number) => {
    const { sweepRecLane } = await import("../../agent/lib/recs/lane");
    return sweepRecLane({ ...quiet, enrich, pick, env: {}, onlyIds: [id] } as never);
  };

  const save = async (over: Partial<Extract<SaveItem, { kind: "rec" }>> = {}) => {
    const { saveAcceptedItem } = await import("../../agent/lib/pipeline/save-item");
    const { id } = await saveAcceptedItem({
      kind: "rec", route: "accept", recType: "book", beeConversationId: null, beeJournalId: null,
      extraction: { canonicalName: NAME, creator: null, recommenderName: null, excerpt: "you should read this one" },
      attribution: { firstName: null, source: "none" }, spokenAt: new Date(), confidence: 0.95, source: "ambient", ...over,
    });
    ids.push(id);
    return id;
  };
  const addRec = async (status: string, set = "") => {
    const { rows } = await c.query(
      `insert into recommendations (type, raw_text, canonical_name, excerpt, said_at, source, status, confidence)
       values ('book', 'it heard', $1, 'it heard', now(), 'ambient', $2, 0.9) returning id`, [NAME, status]);
    const id = Number(rows[0].id);
    ids.push(id);
    if (set) await c.query(`update recommendations set ${set} where id = $1`, [id]);
    return id;
  };
  const status = async (id: number) => (await c.query(`select status from recommendations where id = $1`, [id])).rows[0]?.status;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    c = await pool.connect();
  });

  afterAll(async () => {
    if (!c) return;
    await c.query(`delete from recommendations where id = any($1::bigint[])`, [ids]);
    await c.query(`delete from recommenders where first_name = $1`, [ANN]);
    await c.query(`delete from sync_cursors where name = 'rec_lane_lease'`);
    c.release();
    await pool.end();
  });

  it("saves an overheard tip nobody recommended to Heard nearby, in either band; a person's or a deliberate one as before", async () => {
    const sure = await save();
    const unsure = await save({ route: "review", confidence: 0.7 });
    const fromAnn = await save({ attribution: { firstName: ANN, source: "second_person" } });
    const earmarked = await save({ source: "voice" });
    expect(await status(sure)).toBe("overheard");
    expect(await status(unsure)).toBe("overheard");
    expect(await status(fromAnn)).toBe("new");
    expect(await status(earmarked)).toBe("new");
  });

  it("an overheard tip is only in Heard nearby: not on the Shelf, Home, Maybe? or in search, and the rec lane skips it", async () => {
    const { getShelf, getGardenView, getMaybeTips } = await import("../../agent/lib/garden/queries");
    const { searchEarmarks } = await import("../../agent/lib/search/memory-cue");
    const { getHeardNearby } = await import("../../agent/lib/garden/heard");
    const id = await save();
    const notIn = (list: { id: number }[]) => expect(list.map((t) => t.id)).not.toContain(id);
    notIn(await getShelf());
    notIn(await getShelf(id)); // even a Bee todo's link to it
    notIn((await getGardenView()).shelf);
    notIn((await getMaybeTips()).tips);
    notIn((await searchEarmarks({ query: NAME }, { useNeural: false })).recs);
    expect((await getHeardNearby()).find((t) => t.id === id)).toMatchObject({ name: NAME, excerpt: "you should read this one" });
    expect(await sweep(id)).toMatchObject({ tried: 0 });
    expect(enrich).not.toHaveBeenCalled();
  });

  it("Keep: on the shelf as new, and the lane looks it up; Clear: dismissed. Each only while it is still overheard", async () => {
    const { getShelf, setTipVerdict } = await import("../../agent/lib/garden/queries");
    const kept = await save();
    expect(await setTipVerdict(kept, "kept", { pile: "heard" })).toBe(true);
    expect(await status(kept)).toBe("new");
    expect((await getShelf()).map((t) => t.id)).toContain(kept);
    expect(await sweep(kept)).toMatchObject({ tried: 1 });
    expect(await setTipVerdict(kept, "not_a_tip", { pile: "heard" })).toBe(false); // no longer overheard

    const cleared = await save();
    expect(await setTipVerdict(cleared, "not_a_tip", { pile: "heard" })).toBe(true);
    expect(await status(cleared)).toBe("dismissed");
    const { rows } = await c.query(`select user_verdict from recommendations where id = any($1::bigint[]) order by id`, [[kept, cleared]]);
    expect(rows.map((r) => r.user_verdict)).toEqual(["kept", "not_a_tip"]); // countable: how many Heard nearby items get kept
  });

  it("backfill: a dry run writes nothing; --yes moves only current overheard, person-less tips that are new or maybe", async () => {
    const { moveToHeardNearby } = await import("../../scripts/move-to-heard-nearby");
    const { rows } = await c.query(`insert into recommenders (first_name) values ($1) on conflict (first_name_key) do update set first_name = excluded.first_name returning id`, [ANN]);
    const eligible = [await addRec("new"), await addRec("needs_review")];
    const kept = [
      ...await Promise.all(["queued", "tried", "thanked", "dismissed", "composted"].map((s) => addRec(s))),
      await addRec("new", `recommender_id = ${Number(rows[0].id)}`),
      await addRec("new", `deliberate_key = 'it-heard-${RUN}'`),
      await addRec("new", `bee_journal_id = 'it-heard-${RUN}'`),
      await addRec("new", `source = 'voice'`),
    ];
    const scope = { scopeRecIds: [...eligible, ...kept] };
    const before = await Promise.all(kept.map(status));

    expect(await moveToHeardNearby(c, { yes: false }, scope)).toEqual({ moved: eligible });
    expect(await Promise.all(eligible.map(status))).toEqual(["new", "needs_review"]);

    expect(await moveToHeardNearby(c, { yes: true }, scope)).toEqual({ moved: eligible });
    expect(await Promise.all(eligible.map(status))).toEqual(["overheard", "overheard"]);
    expect(await Promise.all(kept.map(status))).toEqual(before);
    expect(await moveToHeardNearby(c, { yes: true }, scope)).toEqual({ moved: [] }); // re-runnable
  });

  it("forget still finds and deletes an overheard tip", async () => {
    const { forget } = await import("../../agent/lib/privacy/forget");
    const id = await save();
    const deps = { deleteTodo: vi.fn(async () => {}), deleteFact: vi.fn(async () => {}), trashNotionPage: vi.fn(async () => {}), deleteBlob: vi.fn(async () => {}) };
    expect((await forget(c, { type: "rec", id }, { yes: false, deps: deps as ExternalDeps })).plan).toMatchObject({ exists: true });
    expect((await forget(c, { type: "rec", id }, { yes: true, deps: deps as ExternalDeps })).incomplete).toBe(0);
    expect(await status(id)).toBeUndefined();
  });
});
