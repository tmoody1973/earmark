import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "@neondatabase/serverless";

// Real Neon test on the `test` branch: needs TEST_DATABASE_URL (never production). Skipped when absent.
// Synthetic rows only (titles "IT: links …"); every assertion is scoped to the ids this file inserts.
const AT = "2026-10-01T15:00:00Z";
const DIMS = 1536;

// A unit-ish vector along dimension 1000 + `axis`, tilted by `tilt` toward dimension 1100: two vectors on the same axis
// are close (cosine distance ≈ tilt²/2), different axes are orthogonal (distance 1). Far from any real embedding.
const vec = (axis: number, tilt = 0) => {
  const v = new Array<number>(DIMS).fill(0);
  v[1000 + axis] = 1;
  v[1100] = tilt;
  return `[${v.join(",")}]`;
};

describe.skipIf(!process.env.TEST_DATABASE_URL)("backlinks on the Neon test branch (M4-T6)", () => {
  let pool: Pool;
  let c: PoolClient;
  const clusterIds: number[] = [];
  const recIds: number[] = [];

  const addCluster = async (o: { title: string; stage?: string; count?: number; axis: number; tilt?: number; pinned?: boolean; timeline?: unknown[] }) => {
    const { rows } = await c.query(
      `insert into idea_clusters (title, stage, mention_count, centroid, first_mentioned_at, last_mentioned_at, pinned, timeline)
       values ($1, $2, $3, $4::vector, $5, $5, $6, $7::jsonb) returning id`,
      [`IT: links ${o.title}`, o.stage ?? "compost", o.count ?? 1, vec(o.axis, o.tilt), AT, o.pinned ?? false, JSON.stringify(o.timeline ?? [])],
    );
    clusterIds.push(Number(rows[0].id));
    return Number(rows[0].id);
  };
  const addMention = async (clusterId: number, o: { axis: number; at?: string; conv?: number | null; status?: string }) => {
    const { rows } = await c.query(
      `insert into idea_mentions (cluster_id, bee_conversation_id, excerpt, embedding, spoken_at, confidence, review_status, source)
       values ($1, $2, 'it links', $3::vector, $4, 0.95, $5, 'ambient') returning id`,
      [clusterId, o.conv ?? null, vec(o.axis), o.at ?? AT, o.status ?? "accepted"],
    );
    return Number(rows[0].id);
  };
  const addRec = async (status: string, axis: number) => {
    const { rows } = await c.query(
      `insert into recommendations (type, raw_text, canonical_name, excerpt, said_at, source, status, confidence, embedding)
       values ('album', 'it links', 'IT links album', 'it links', $1, 'ambient', $2, 0.95, $3::vector) returning id`,
      [AT, status, vec(axis)],
    );
    recIds.push(Number(rows[0].id));
    return Number(rows[0].id);
  };
  const cluster = async (id: number) =>
    (await c.query(`select stage, mention_count, pinned, timeline, first_mentioned_at, last_mentioned_at, centroid is not null as has_centroid
                    from idea_clusters where id = $1`, [id])).rows[0];
  const mentionsOf = async (id: number) =>
    (await c.query(`select id from idea_mentions where cluster_id = $1 order by id`, [id])).rows.map((r) => Number(r.id));
  const link = async (from: [string, number], to: [string, number], kind: string) =>
    (await c.query(`select status, confidence, judged_at from links where from_type = $1 and from_id = $2 and to_type = $3 and to_id = $4 and kind = $5`,
      [from[0], String(from[1]), to[0], String(to[1]), kind])).rows[0];
  const addLink = async (from: [string, number], to: [string, number], kind: string, confidence: number, status = "suggested") =>
    c.query(`insert into links (from_type, from_id, to_type, to_id, kind, confidence, status) values ($1, $2, $3, $4, $5, $6, $7)`,
      [from[0], String(from[1]), to[0], String(to[1]), kind, confidence, status]);

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    c = await pool.connect();
  });

  afterAll(async () => {
    if (!c) return;
    const ids = clusterIds.map(String);
    const rids = recIds.map(String);
    await c.query(`delete from links where (from_type = 'idea' and from_id = any($1)) or (to_type = 'idea' and to_id = any($1)) or (from_type = 'rec' and from_id = any($2))`, [ids, rids]);
    await c.query(`delete from idea_merges where keep_id = any($1::bigint[]) or merged_id = any($1::bigint[])`, [clusterIds]);
    await c.query(`delete from recommendations where id = any($1::bigint[])`, [recIds]);
    await c.query(`delete from idea_clusters where id = any($1::bigint[])`, [clusterIds]); // cascades to mentions + events
    c.release();
    await pool.end();
  });

  it("candidates: near pairs once, re-asked only after a change, never once Tarik decided; hidden tips never", async () => {
    const { ideaPairCandidates, recIdeaCandidates } = await import("../../agent/lib/links/candidates");
    const a = await addCluster({ title: "cand a", axis: 1, timeline: [{ date: AT, line: "Oct 1: first heard" }] });
    const b = await addCluster({ title: "cand b", axis: 1, tilt: 0.1 });
    const far = await addCluster({ title: "cand far", axis: 2 });
    const gone = await addCluster({ title: "cand dismissed", axis: 1, tilt: 0.05, stage: "dismissed" });
    const visibleRec = await addRec("new", 1);
    const maybeRec = await addRec("needs_review", 1);
    const mine = (ps: Array<{ a: { id: number }; b: { id: number } }>) =>
      ps.filter((p) => clusterIds.includes(p.a.id) && clusterIds.includes(p.b.id)).map((p) => [p.a.id, p.b.id]);

    const pairs = mine(await ideaPairCandidates(500));
    expect(pairs).toContainEqual([Math.min(a, b), Math.max(a, b)]);
    expect(pairs.flat()).not.toContain(far); // orthogonal: beyond IDEA_PAIR_MAX_DISTANCE
    expect(pairs.flat()).not.toContain(gone);
    const withA = (await ideaPairCandidates(500)).find((p) => p.a.id === Math.min(a, b) && p.b.id === Math.max(a, b))!;
    expect([withA.a, withA.b].find((x) => x.id === a)!.notes).toEqual(["Oct 1: first heard"]);

    // judged → not asked again
    await addLink(["idea", Math.min(a, b)], ["idea", Math.max(a, b)], "related", 0.4);
    await c.query(`update links set judged_at = now() + interval '1 minute' where from_id = $1 and to_id = $2`, [String(Math.min(a, b)), String(Math.max(a, b))]);
    expect(mine(await ideaPairCandidates(500))).not.toContainEqual([Math.min(a, b), Math.max(a, b)]);
    // a changed idea (a new mention bumps updated_at past judged_at) → asked again
    await c.query(`update idea_clusters set updated_at = now() + interval '2 minutes' where id = $1`, [a]);
    expect(mine(await ideaPairCandidates(500))).toContainEqual([Math.min(a, b), Math.max(a, b)]);
    // Tarik accepted or removed it → never asked again, changed or not
    await c.query(`update links set status = 'removed' where from_id = $1 and to_id = $2`, [String(Math.min(a, b)), String(Math.max(a, b))]);
    expect(mine(await ideaPairCandidates(500))).not.toContainEqual([Math.min(a, b), Math.max(a, b)]);

    const fits = (await recIdeaCandidates(500)).filter((f) => recIds.includes(f.rec.id));
    expect(fits.map((f) => [f.rec.id, f.idea.id])).toEqual(expect.arrayContaining([[visibleRec, a], [visibleRec, b]]));
    expect(fits.map((f) => f.rec.id)).not.toContain(maybeRec);
    expect(fits.map((f) => f.idea.id)).not.toContain(gone);
  });

  it("refresh writes upserts that refresh a suggestion but never Tarik's decision", async () => {
    const { writeIdeaPair, writeRecFit } = await import("../../agent/lib/links/refresh");
    const a = await addCluster({ title: "write a", axis: 3 });
    const b = await addCluster({ title: "write b", axis: 3 });
    const r = await addRec("new", 3);
    await writeIdeaPair(a, b, { related: 0.8, sameIdea: 0.3 });
    await writeRecFit(r, a, 0.75);
    expect(await link(["idea", a], ["idea", b], "related")).toMatchObject({ status: "suggested", confidence: 0.8 });
    expect(await link(["idea", a], ["idea", b], "merge_suggestion")).toMatchObject({ confidence: 0.3 });
    expect(await link(["rec", r], ["idea", a], "fits")).toMatchObject({ status: "suggested", confidence: 0.75 });
    await c.query(`update links set status = 'removed' where from_id = $1 and to_id = $2 and kind = 'merge_suggestion'`, [String(a), String(b)]);
    await writeIdeaPair(a, b, { related: 0.6, sameIdea: 0.95 });
    expect(await link(["idea", a], ["idea", b], "related")).toMatchObject({ status: "suggested", confidence: 0.6 });
    expect(await link(["idea", a], ["idea", b], "merge_suggestion")).toMatchObject({ status: "removed", confidence: 0.3 });
  });

  it("getBacklinks and setLinkStatus: floors, visibility, both directions, and state-guarded writes", async () => {
    const { getBacklinks, setLinkStatus } = await import("../../agent/lib/garden/backlinks");
    const me = await addCluster({ title: "bl me", axis: 4, count: 2, stage: "sprouting" });
    const strong = await addCluster({ title: "bl strong", axis: 4 });
    const weak = await addCluster({ title: "bl weak", axis: 4 });
    const twin = await addCluster({ title: "bl twin", axis: 4 });
    const dismissed = await addCluster({ title: "bl dismissed", axis: 4, stage: "dismissed" });
    const emptied = await addCluster({ title: "bl emptied", axis: 4, count: 0 });
    const tip = await addRec("queued", 4);
    const maybe = await addRec("needs_review", 4);
    await addLink(["idea", Math.min(me, strong)], ["idea", Math.max(me, strong)], "related", 0.9);
    await addLink(["idea", Math.min(me, weak)], ["idea", Math.max(me, weak)], "related", 0.5);
    await addLink(["idea", Math.min(me, twin)], ["idea", Math.max(me, twin)], "merge_suggestion", 0.85);
    await addLink(["idea", Math.min(me, dismissed)], ["idea", Math.max(me, dismissed)], "related", 0.95);
    await addLink(["idea", Math.min(me, emptied)], ["idea", Math.max(me, emptied)], "related", 0.95);
    await addLink(["rec", tip], ["idea", me], "fits", 0.9);
    await addLink(["rec", maybe], ["idea", me], "fits", 0.99);

    let bl = await getBacklinks(me);
    expect(bl.related.map((l) => l.plant.id)).toEqual([strong]);
    expect(bl.sameIdea.map((l) => l.plant.id)).toEqual([twin]);
    expect(bl.fits.map((l) => l.rec.id)).toEqual([tip]);
    // the other side sees the same link
    expect((await getBacklinks(strong)).related.map((l) => l.plant.id)).toEqual([me]);

    const key = bl.related[0].key;
    expect(await setLinkStatus(key, "accepted")).toBe(true);
    expect(await setLinkStatus(key, "accepted")).toBe(false); // already accepted: no write
    expect((await getBacklinks(me)).related[0].status).toBe("accepted");
    expect(await setLinkStatus(bl.fits[0].key, "removed")).toBe(true);
    expect(await setLinkStatus(bl.fits[0].key, "accepted")).toBe(false); // a removed link is never revived
    bl = await getBacklinks(me);
    expect(bl.fits).toEqual([]);
  });

  it("merge moves mentions (not ones from a shared conversation) and their timeline lines, recounts, blooms; undo restores both ideas", async () => {
    const { mergeClusters, undoMerge } = await import("../../agent/lib/garden/merge");
    const OCT5_K = "2026-10-05T18:00:00.000Z";
    const OCT5_M = "2026-10-05T15:00:00.000Z";
    // Identical lines on purpose: the kept idea's first line equals the merged idea's line for its shared-conversation
    // mention, and both have an "Oct 5: added a host" line. Lines move by their mention, never by their text.
    const keep = await addCluster({ title: "merge keep", axis: 5, count: 2, stage: "sprouting",
      timeline: [{ date: AT, line: "Oct 1: first heard" }, { date: OCT5_K, line: "Oct 5: added a host" }] });
    const other = await addCluster({ title: "merge other", axis: 5, count: 2, stage: "sprouting", pinned: true,
      timeline: [{ date: OCT5_M, line: "Oct 5: added a host" }, { date: AT, line: "Oct 1: first heard" }] });
    await addMention(keep, { axis: 5, conv: 9_000_001 });
    await addMention(keep, { axis: 5, conv: 9_000_002, at: OCT5_K });
    const moved = await addMention(other, { axis: 5, conv: 9_000_003, at: OCT5_M });
    const shared = await addMention(other, { axis: 5, conv: 9_000_001 }); // same conversation as one of keep's: stays put
    await addLink(["idea", Math.min(keep, other)], ["idea", Math.max(keep, other)], "merge_suggestion", 0.9);
    const keepBefore = await cluster(keep);
    const otherBefore = await cluster(other);
    const dates = (t: Array<{ date: string }>) => t.map((e) => new Date(e.date).toISOString()).sort();

    const mergeId = await mergeClusters(keep, other);
    expect(mergeId).toEqual(expect.any(Number));
    const k = await cluster(keep);
    expect(k).toMatchObject({ stage: "ready", mention_count: 3, pinned: true, has_centroid: true });
    expect(dates(k.timeline)).toEqual([AT, OCT5_M, OCT5_K].map((d) => new Date(d).toISOString()).sort());
    const o = await cluster(other);
    expect(o).toMatchObject({ stage: "dismissed", mention_count: 1 });
    expect(o.timeline).toEqual([{ date: AT, line: "Oct 1: first heard" }]); // moved, not copied
    expect(await mentionsOf(keep)).toContain(moved);
    expect(await mentionsOf(other)).toEqual([shared]);
    expect((await c.query(`select kind from garden_events where cluster_id = $1 order by id desc limit 1`, [keep])).rows[0].kind).toBe("bloom");
    expect((await link(["idea", Math.min(keep, other)], ["idea", Math.max(keep, other)], "merge_suggestion")).status).toBe("accepted");
    // the merge record holds ids and stage/count/pin only: no idea text
    const rec = (await c.query(`select keep_before, merged_before from idea_merges where id = $1`, [mergeId])).rows[0];
    expect(Object.keys(rec.keep_before).sort()).toEqual(["mention_count", "pinned", "stage"]);
    expect(Object.keys(rec.merged_before).sort()).toEqual(["mention_count", "pinned", "stage"]);

    // a second merge of the same pair (double click) changes nothing
    expect(await mergeClusters(keep, other)).toBeNull();
    expect(await cluster(keep)).toMatchObject({ mention_count: 3 });

    const { getBacklinks } = await import("../../agent/lib/garden/backlinks");
    expect((await getBacklinks(other)).mergedInto).toMatchObject({ mergeId, ideaId: keep });
    expect((await getBacklinks(keep)).mergedIn).toEqual([expect.objectContaining({ mergeId, ideaId: other })]);

    expect(await undoMerge(mergeId!)).toBe(true);
    expect(await undoMerge(mergeId!)).toBe(false); // double undo: no-op
    const k2 = await cluster(keep);
    const o2 = await cluster(other);
    expect(k2).toMatchObject({ stage: keepBefore.stage, mention_count: keepBefore.mention_count, pinned: false });
    expect(k2.timeline).toEqual(keepBefore.timeline); // its own identical lines stay
    expect(o2).toMatchObject({ stage: otherBefore.stage, mention_count: otherBefore.mention_count, pinned: true });
    expect(dates(o2.timeline)).toEqual(dates(otherBefore.timeline));
    expect((await mentionsOf(other)).sort()).toEqual([moved, shared].sort());
    expect((await link(["idea", Math.min(keep, other)], ["idea", Math.max(keep, other)], "merge_suggestion")).status).toBe("removed");
    expect((await getBacklinks(other)).mergedInto).toBeNull();
  });

  it("undo refuses when a moved mention no longer exists", async () => {
    const { mergeClusters, undoMerge } = await import("../../agent/lib/garden/merge");
    const keep = await addCluster({ title: "gone keep", axis: 7, timeline: [{ date: AT, line: "Oct 1: first heard" }] });
    const other = await addCluster({ title: "gone other", axis: 7, timeline: [{ date: "2026-10-02T15:00:00.000Z", line: "Oct 2: first heard" }] });
    await addMention(keep, { axis: 7, conv: 9_100_001 });
    const moved = await addMention(other, { axis: 7, conv: 9_100_002, at: "2026-10-02T15:00:00.000Z" });
    const mergeId = await mergeClusters(keep, other);
    await c.query(`delete from idea_mentions where id = $1`, [moved]);
    expect(await undoMerge(mergeId!)).toBe(false);
    expect((await c.query(`select undone_at from idea_merges where id = $1`, [mergeId])).rows[0].undone_at).toBeNull();
    expect(await cluster(other)).toMatchObject({ stage: "dismissed" });
  });

  it("undo after the merged idea bloomed and drafted takes the draft back with the bloom", async () => {
    const { mergeClusters, undoMerge } = await import("../../agent/lib/garden/merge");
    const keep = await addCluster({ title: "draft keep", axis: 8, count: 2, stage: "sprouting",
      timeline: [{ date: AT, line: "Oct 1: first heard" }, { date: "2026-10-02T15:00:00.000Z", line: "Oct 2: again" }] });
    const other = await addCluster({ title: "draft other", axis: 8, timeline: [{ date: "2026-10-03T15:00:00.000Z", line: "Oct 3: first heard" }] });
    await addMention(keep, { axis: 8, conv: 9_200_001 });
    await addMention(keep, { axis: 8, conv: 9_200_002, at: "2026-10-02T15:00:00.000Z" });
    await addMention(other, { axis: 8, conv: 9_200_003, at: "2026-10-03T15:00:00.000Z" });
    const mergeId = await mergeClusters(keep, other);
    expect(await cluster(keep)).toMatchObject({ stage: "ready" });
    // the draft job wrote a one-pager from all three mentions
    await c.query(`update idea_clusters set stage = 'drafted', summary = 's', draft_md = 'd', draft_format = 'product_brief',
                   draft_claimed_at = now() where id = $1`, [keep]);
    expect(await undoMerge(mergeId!)).toBe(true);
    const k = (await c.query(`select stage, mention_count, summary, draft_md, draft_format, draft_claimed_at from idea_clusters where id = $1`, [keep])).rows[0];
    expect(k).toEqual({ stage: "sprouting", mention_count: 2, summary: null, draft_md: null, draft_format: null, draft_claimed_at: null });
  });

  it("refuses to merge into or from a dismissed idea", async () => {
    const { mergeClusters } = await import("../../agent/lib/garden/merge");
    const live = await addCluster({ title: "guard live", axis: 6 });
    const dead = await addCluster({ title: "guard dead", axis: 6, stage: "dismissed" });
    await addMention(dead, { axis: 6 });
    expect(await mergeClusters(live, dead)).toBeNull();
    expect(await mergeClusters(dead, live)).toBeNull();
    expect(await mentionsOf(live)).toEqual([]);
  });
});
