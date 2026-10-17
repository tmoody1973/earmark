import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../agent/lib/db";
import { proposeIdeaFacts, writePendingProposals } from "../../agent/lib/facts/proposals";

// M5-T7 (MOO-917) fix round, real Neon `test` branch (TEST_DATABASE_URL, never production). The Bee client is a fake:
// nothing here can reach a real Bee account, and there are no model calls.
const hook = vi.hoisted(() => ({ failRecordOnce: false }));
vi.mock("../../agent/lib/db", async (orig) => {
  const actual = await orig<typeof import("../../agent/lib/db")>();
  return {
    ...actual,
    // Wraps the real client so a test can make the "record the Bee id" statement throw once, after Bee already created the fact.
    db: () => {
      const real = actual.db();
      return ((strings: TemplateStringsArray, ...values: unknown[]) => {
        if (hook.failRecordOnce && strings.join("?").includes("insert into bee_sync")) {
          hook.failRecordOnce = false;
          return Promise.reject(new Error("db down"));
        }
        return real(strings, ...values);
      }) as typeof real;
    },
  };
});

const MARK = "INTTEST-FP";
const sql = () => db();
let nextBeeId = 9_000_000 + Math.floor(Math.random() * 900_000);

function fakeBee(delayMs = 0) {
  const facts: { id: number; text: string }[] = [];
  const createFact = vi.fn(async (text: string) => {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    const f = { id: nextBeeId++, text };
    facts.push(f);
    return f;
  });
  const listFacts = vi.fn(async () => ({ facts: [...facts], next_cursor: null }));
  return { bee: { createFact, listFacts } as never, createFact, listFacts, facts };
}

const insertProposal = async (text: string) => {
  const [r] = (await sql()`insert into fact_proposals (text, kind, evidence_ids) values (${text}, 'taste', '[1,2,3]'::jsonb) returning id`) as { id: string }[];
  return Number(r.id);
};
const proposal = async (id: number) =>
  ((await sql()`select bee_fact_id, write_started_at, status from fact_proposals where id = ${id}`) as { bee_fact_id: string | null; write_started_at: string | null; status: string }[])[0]!;

const cleanup = async () => {
  await sql()`delete from bee_sync where entity_type = 'fact_proposal' and entity_id in (select id from fact_proposals)`;
  await sql()`delete from fact_proposals`; // test branch only: keeps the per-run cap from being eaten by stray pending rows
  await sql()`delete from idea_clusters where title like ${MARK + "%"}`;
  await sql()`delete from recommenders where first_name = 'Zorblat'`;
};

describe.skipIf(!process.env.TEST_DATABASE_URL)("fact proposals (real Neon, fake Bee)", () => {
  beforeAll(cleanup);
  beforeEach(cleanup);
  afterAll(cleanup);

  it("a post that succeeds but whose DB record throws is never repeated: the next run reconciles", async () => {
    const id = await insertProposal(`${MARK} Loves spiritual jazz`);
    const { bee, createFact, listFacts } = fakeBee();
    hook.failRecordOnce = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await writePendingProposals(bee)).toBe(0);
    expect(createFact).toHaveBeenCalledTimes(1);
    expect((await proposal(id)).bee_fact_id).toBeNull();

    // Right away the claim is still fresh: nothing is posted.
    expect(await writePendingProposals(bee)).toBe(0);
    expect(createFact).toHaveBeenCalledTimes(1);

    // After the claim goes stale, the run finds the fact in Bee and adopts its id instead of posting again.
    await sql()`update fact_proposals set write_started_at = now() - interval '20 minutes' where id = ${id}`;
    expect(await writePendingProposals(bee)).toBe(1);
    expect(createFact).toHaveBeenCalledTimes(1);
    expect(listFacts).toHaveBeenCalled();
    const p = await proposal(id);
    expect(Number(p.bee_fact_id)).toBeGreaterThan(0);
    const [s] = (await sql()`select bee_id from bee_sync where entity_type = 'fact_proposal' and entity_id = ${id}`) as { bee_id: string }[];
    expect(Number(s!.bee_id)).toBe(Number(p.bee_fact_id));
  });

  it("two concurrent runs post each proposal exactly once", async () => {
    const texts = [`${MARK} Loves ramen`, `${MARK} Enjoys dub`, `${MARK} Loves film noir`];
    for (const t of texts) await insertProposal(t);
    const { bee, createFact } = fakeBee(30);
    const [a, b] = await Promise.all([writePendingProposals(bee), writePendingProposals(bee)]);
    expect(a + b).toBe(3);
    const posted = createFact.mock.calls.map((c) => c[0]).sort();
    expect(posted).toEqual([...texts].sort());
  });

  it("writes at most 5 facts per run", async () => {
    for (let i = 0; i < 7; i++) await insertProposal(`${MARK} Loves thing ${i}`);
    const { bee, createFact } = fakeBee();
    expect(await writePendingProposals(bee)).toBe(5);
    expect(createFact).toHaveBeenCalledTimes(5);
  });

  it("the bee_sync upsert hits its primary key: a re-record updates the one row", async () => {
    const id = await insertProposal(`${MARK} Loves dub`);
    const { bee } = fakeBee();
    await writePendingProposals(bee);
    const first = Number((await proposal(id)).bee_fact_id);
    await sql()`update fact_proposals set bee_fact_id = null, write_started_at = null where id = ${id}`;
    await writePendingProposals(bee);
    const rows = (await sql()`select bee_id from bee_sync where entity_type = 'fact_proposal' and entity_id = ${id}`) as { bee_id: string }[];
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.bee_id)).toBe(Number((await proposal(id)).bee_fact_id));
    expect(Number(rows[0]!.bee_id)).not.toBe(first);
  });

  it("idea dedupe works on real bigint/jsonb, a rejected proposal is never re-proposed, names are filtered, 3 per run", async () => {
    await sql()`insert into recommenders (first_name) values ('Zorblat')`;
    const mk = async (title: string) =>
      Number(((await sql()`
        insert into idea_clusters (title, stage, mention_count, first_mentioned_at)
        values (${MARK + " " + title}, 'ready', 9999, '2026-09-10T15:00:00Z') returning id`) as { id: string }[])[0]!.id);
    const ids = [await mk("one"), await mk("two"), await mk("three"), await mk("four")];
    const named = await mk("Zorblat's podcast");
    const count = async (cid: number) =>
      Number(((await sql()`select count(*) as n from fact_proposals where kind = 'idea' and evidence_ids @> to_jsonb(array[${cid}::bigint])`) as { n: string }[])[0]!.n);

    expect(await proposeIdeaFacts()).toBe(3);
    const proposed = (await Promise.all(ids.map(count))).reduce((a, b) => a + b, 0);
    expect(proposed).toBe(3);
    expect(await count(named)).toBe(0); // names a recommender: never proposed

    // Reject one; neither a second run nor a third ever proposes any cluster twice, rejected included.
    const [rej] = (await sql()`update fact_proposals set status = 'rejected' where id = (select min(id) from fact_proposals where kind = 'idea') returning evidence_ids`) as { evidence_ids: number[] }[];
    await proposeIdeaFacts();
    await proposeIdeaFacts();
    for (const cid of ids) expect(await count(cid)).toBe(1);
    expect(await count(Number(rej!.evidence_ids[0]))).toBe(1);
  });
});
