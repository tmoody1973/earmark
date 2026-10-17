import { afterAll, describe, expect, it } from "vitest";

// Real Neon test on the `test` branch: needs TEST_DATABASE_URL (never production). Skipped when absent.
// Run: pnpm test:int
const RUN = Date.now() % 1_000_000_000;
const NAME = `Itforget${RUN}`;

describe.skipIf(!process.env.TEST_DATABASE_URL)("forget on the Neon test branch", () => {
  const spaceIds: number[] = [];
  const clusterIds: number[] = [];
  const mods = async () => ({
    ...(await import("../../agent/lib/db")),
    ...(await import("../../agent/lib/privacy/forget")),
  });

  afterAll(async () => {
    const { db } = await mods();
    for (const id of spaceIds) await db()`delete from spaces where id = ${id}`;
    for (const id of clusterIds) await db()`delete from idea_clusters where id = ${id}`;
    await db()`delete from recommenders where first_name = ${NAME}`;
  });

  it("deletes a rec with its links, Space items, sync rows, receipts and its now-unused recommender", async () => {
    const { db, deleteRows, forget, loadForgetRefs } = await mods();
    const sql = db();
    const [p] = await sql`insert into recommenders (first_name, recs_given) values (${NAME}, 1) returning id`;
    const [r] = await sql`insert into recommendations (type, raw_text, canonical_name, recommender_id, attribution_source, excerpt, said_at, source, confidence, bee_todo_id)
                          values ('book', 'it forget', 'IT Forget', ${p!.id}, 'voice_trigger', 'it forget excerpt', now(), 'voice', 0.9, ${9_000_000_000 + RUN})
                          returning id`;
    const id = Number(r!.id);
    const [s] = await sql`insert into spaces (name, rule_sentence) values ('IT forget', 'it') returning id`;
    spaceIds.push(Number(s!.id));
    await sql`insert into space_items (space_id, item_type, item_id, confidence) values (${s!.id}, 'rec', ${id}, 0.9)`;
    await sql`insert into links (from_type, from_id, to_type, to_id, kind, confidence) values ('rec', ${String(id)}, 'recommender', ${String(p!.id)}, 'source', 1)`;
    await sql`insert into rec_receipts (recommendation_id, message, share_token) values (${id}, 'thanks', ${`it-forget-${RUN}`})`;

    expect(await loadForgetRefs({ type: "rec", id })).toMatchObject({ exists: true, beeTodoIds: [9_000_000_000 + RUN] });
    await deleteRows({ type: "rec", id });

    const [left] = await sql`select
      (select count(*)::int from recommendations where id = ${id}) as recs,
      (select count(*)::int from space_items where item_type = 'rec' and item_id = ${id}) as space_items,
      (select count(*)::int from links where from_type = 'rec' and from_id = ${String(id)}) as links,
      (select count(*)::int from rec_receipts where recommendation_id = ${id}) as receipts,
      (select count(*)::int from recommenders where id = ${p!.id}) as recommenders`;
    expect(left).toEqual({ recs: 0, space_items: 0, links: 0, receipts: 0, recommenders: 0 });
    expect(await forget({ type: "rec", id })).toEqual([`nothing to forget for rec ${id}`]);
  });

  it("forgets one mention: drops its timeline line and recomputes the idea; the last mention forgets the idea", async () => {
    const { db, deleteRows, forget } = await mods();
    const sql = db();
    const a = "2026-10-01T15:00:00.000Z";
    const b = "2026-10-03T15:00:00.000Z";
    const timeline = JSON.stringify([{ date: a, line: "Oct 1: first" }, { date: b, line: "Oct 3: second" }]);
    const [c] = await sql`insert into idea_clusters (title, stage, mention_count, first_mentioned_at, last_mentioned_at, timeline)
                          values ('IT forget idea', 'sprouting', 2, ${a}, ${b}, ${timeline}::jsonb) returning id`;
    const clusterId = Number(c!.id);
    clusterIds.push(clusterId);
    const [m1] = await sql`insert into idea_mentions (cluster_id, excerpt, spoken_at, confidence, source)
                           values (${clusterId}, 'first excerpt', ${a}, 0.9, 'voice') returning id`;
    const [m2] = await sql`insert into idea_mentions (cluster_id, excerpt, spoken_at, confidence, source)
                           values (${clusterId}, 'second excerpt', ${b}, 0.9, 'voice') returning id`;

    await deleteRows({ type: "mention", id: Number(m2!.id) });
    const [after] = await sql`select mention_count, stage, timeline, last_mentioned_at from idea_clusters where id = ${clusterId}`;
    expect(after).toMatchObject({ mention_count: 1, stage: "compost", timeline: [{ date: a, line: "Oct 1: first" }] });
    expect(new Date(after!.last_mentioned_at as string).toISOString()).toBe(a);

    const dry = await forget({ type: "mention", id: Number(m1!.id) }, { dryRun: true });
    expect(dry[0]).toContain(`last mention of idea ${clusterId}`);
    expect(dry.at(-1)).toBe(`would delete ${JSON.stringify({ kind: "db", target: { type: "idea", id: clusterId } })}`);
  });
});
