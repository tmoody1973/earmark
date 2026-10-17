import { readFile } from "node:fs/promises";
import { Pool } from "@neondatabase/serverless";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "../../agent/lib/db";
import { decideRun } from "../../agent/lib/gardeners/decide";
import { getGardener, NotClaimedError, runDueGardeners, runGardener, type GardenerRow } from "../../agent/lib/gardeners/run";
import { runEpisode } from "../../agent/lib/episode/publish";
import { weekOfSunday } from "../../agent/lib/time";

// M5-T12 (MOO-922), real Neon `test` branch (TEST_DATABASE_URL, never production). No model, Polly or Blob calls:
// the writer, voice and upload are fakes. Dates are in 2099 so they never collide with real rows or other suites.
const FRIDAY_A = new Date("2099-05-08T15:00:00Z"); // a Friday; the 13:00 UTC Sunday episode gardener is not due
const FRIDAY_A_LATER = new Date("2099-05-08T18:00:00Z");
const FRIDAY_B = new Date("2099-05-15T15:00:00Z");
const EP_A = new Date("2099-05-06T17:00:00Z");
const EP_B = new Date("2099-05-13T17:00:00Z");
const WEEKS = [weekOfSunday(EP_A), weekOfSunday(EP_B)];

const epFakes = () => ({
  gather: vi.fn(async () => ({ growing: [], ready: [], newInCrate: [], dontForget: [], thanksOwed: [] })),
  write: vi.fn(async () => ({ title: "Gardener inttest", script: "Hello from the gardener test." })),
  voice: vi.fn(async () => new Uint8Array([1, 2, 3])),
  upload: vi.fn(async (week: string) => `https://blob.test/episodes/earmark-${week}-g.mp3`),
});
const sql = () => db();

describe.skipIf(!process.env.TEST_DATABASE_URL)("gardeners (real Neon)", () => {
  let customId = 0;
  const extraIds: number[] = [];
  const plant = async (name: string, schedule: string, enabled = true) => {
    const [r] = (await sql()`insert into gardeners (name, task, schedule, sources, enabled) values (${name}, 'Turn my ready ideas into pitches.', ${schedule}::jsonb, '{ideas}'::text[], ${enabled}) returning id`) as { id: string }[];
    extraIds.push(Number(r.id));
    return Number(r.id);
  };
  const cleanup = async () => {
    if (customId) await sql()`delete from gardeners where id = ${customId}`; // cascades to its runs
    for (const id of extraIds) await sql()`delete from gardeners where id = ${id}`;
    await sql()`delete from gardener_runs where episode_id in (select id from episodes where week_of = any(${WEEKS}::date[]))`;
    await sql()`delete from episodes where week_of = any(${WEEKS}::date[])`;
    await sql()`update gardeners set last_run_at = null, last_attempt_at = null, fail_count = 0 where kind = 'episode'`;
  };
  beforeAll(cleanup);
  afterAll(cleanup);

  it("the seed adds exactly one 'Weekly episode' gardener, even when the migration runs twice more", async () => {
    const file = await readFile("db/migrations/032_gardeners.sql", "utf8");
    const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    try {
      await pool.query(file);
      await pool.query(file);
    } finally {
      await pool.end();
    }
    const rows = (await sql()`select name, kind, needs_approval from gardeners where kind = 'episode'`) as Record<string, unknown>[];
    expect(rows).toEqual([{ name: "Weekly episode", kind: "episode", needs_approval: true }]);
  });

  it("picks a gardener once per period: a second tick in the same period does not re-run it", async () => {
    const [row] = (await sql()`
      insert into gardeners (name, task, schedule, sources)
      values ('Inttest Friday', 'Turn my ready ideas into pitches.', '{"every":"week","weekday":5,"hourUtc":14}'::jsonb, '{ideas}'::text[]) returning id`) as { id: string }[];
    customId = Number(row.id);
    const generateImpl = vi.fn(async () => ({ text: "A pitch." }));
    const tick = (now: Date) => runDueGardeners(now, { run: (g: GardenerRow) => runGardener(g, { generateImpl: generateImpl as never, now }) });
    const countRuns = async () => Number(((await sql()`select count(*)::int as n from gardener_runs where gardener_id = ${customId}`) as { n: number }[])[0].n);

    expect(await tick(FRIDAY_A)).toEqual({ ran: 1, failed: 0 });
    expect(await tick(FRIDAY_A_LATER)).toEqual({ ran: 0, failed: 0 });
    expect(generateImpl).toHaveBeenCalledTimes(1);
    expect(await countRuns()).toBe(1);
    expect(await tick(FRIDAY_B)).toEqual({ ran: 1, failed: 0 }); // the next period runs again
    expect(await countRuns()).toBe(2);
    const [run] = (await sql()`select status, output_md from gardener_runs where gardener_id = ${customId} order by id limit 1`) as { status: string; output_md: string }[];
    expect(run).toEqual({ status: "draft", output_md: "A pitch." });
  });

  it("an episode run delegates to runEpisode and links episode_id; approving publishes, dismissing does not", async () => {
    const [g] = (await sql()`select id, name, kind, task, schedule, sources, needs_approval, last_run_at, last_attempt_at, fail_count from gardeners where kind = 'episode'`) as GardenerRow[];

    const fakesA = epFakes();
    const runA = await runGardener(g, { episode: (now) => runEpisode(now, fakesA as never), now: EP_A });
    expect(fakesA.write).toHaveBeenCalledTimes(1);
    const [linkedA] = (await sql()`select r.status, r.episode_id, e.week_of::text as week_of, e.published_at from gardener_runs r join episodes e on e.id = r.episode_id where r.id = ${runA}`) as Record<string, unknown>[];
    expect(linkedA).toMatchObject({ status: "draft", week_of: WEEKS[0], published_at: null });

    await decideRun(runA, "approved");
    const published = async (week: string) => ((await sql()`select published_at from episodes where week_of = ${week}`) as { published_at: string | null }[])[0].published_at;
    const at = await published(WEEKS[0]);
    expect(at).not.toBeNull();
    await decideRun(runA, "approved"); // idempotent: the stamp does not move
    expect(await published(WEEKS[0])).toEqual(at);
    await decideRun(runA, "dismissed"); // an approved run cannot be dismissed into a mess
    expect(((await sql()`select status from gardener_runs where id = ${runA}`) as { status: string }[])[0].status).toBe("approved");

    const gB = (await getGardener(g.id))!;
    const runB = await runGardener(gB, { episode: (now) => runEpisode(now, epFakes() as never), now: EP_B });
    await decideRun(runB, "dismissed");
    await decideRun(runB, "approved"); // too late: dismissed stays dismissed and unpublished
    expect(await published(WEEKS[1])).toBeNull();
    expect(((await sql()`select status from gardener_runs where id = ${runB}`) as { status: string }[])[0].status).toBe("dismissed");
  });

  const WED = new Date("2099-05-06T10:00:00Z"); // schedule below: Wednesday 09:00 UTC
  const at = (h: number, m = 0) => new Date(`2099-05-06T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);
  const runsOf = async (id: number) => Number(((await sql()`select count(*)::int as n from gardener_runs where gardener_id = ${id}`) as { n: number }[])[0].n);

  it("a failing gardener is not retried on the next tick, is retried after the backoff, and stops at the maximum", async () => {
    const id = await plant("Inttest failing", '{"every":"week","weekday":3,"hourUtc":9}');
    const generateImpl = vi.fn(async () => { throw new TypeError("model down"); });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const tick = (now: Date) => runDueGardeners(now, { run: (g: GardenerRow) => runGardener(g, { generateImpl: generateImpl as never, now }) });
    expect(await tick(at(10))).toEqual({ ran: 0, failed: 1 }); // attempt 1
    expect(await tick(at(11))).toEqual({ ran: 0, failed: 0 }); // next hourly tick: backed off
    expect(generateImpl).toHaveBeenCalledTimes(1);
    expect(await tick(at(13, 5))).toEqual({ ran: 0, failed: 1 }); // retry 1, 3h later
    expect(await tick(at(16, 10))).toEqual({ ran: 0, failed: 1 }); // retry 2
    expect(await tick(at(23, 59))).toEqual({ ran: 0, failed: 0 }); // maximum reached for the period
    expect(generateImpl).toHaveBeenCalledTimes(3);
    expect(await runsOf(id)).toBe(0);
    expect(JSON.stringify(err.mock.calls)).not.toContain("model down");
    err.mockRestore();
    const [row] = (await sql()`select fail_count from gardeners where id = ${id}`) as { fail_count: number }[];
    expect(row.fail_count).toBe(3);
  });

  it("two concurrent runs of the same gardener produce exactly one draft", async () => {
    const id = await plant("Inttest concurrent", '{"every":"week","weekday":2,"hourUtc":9}');
    const g = (await getGardener(id))!;
    const generateImpl = vi.fn(async () => ({ text: "One draft." }));
    const go = () => runGardener(g, { generateImpl: generateImpl as never, now: WED });
    const results = await Promise.allSettled([go(), go()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(NotClaimedError);
    expect(generateImpl).toHaveBeenCalledTimes(1);
    expect(await runsOf(id)).toBe(1);
  });

  it("paused gardeners are never picked, by the schedule or by Run now; resuming brings them back", async () => {
    const id = await plant("Inttest paused", '{"every":"week","weekday":1,"hourUtc":9}', false);
    const MON = new Date("2099-05-04T10:00:00Z");
    const generateImpl = vi.fn(async () => ({ text: "Paused draft." }));
    const tick = () => runDueGardeners(MON, { run: (g: GardenerRow) => runGardener(g, { generateImpl: generateImpl as never, now: MON }) });
    expect(await tick()).toEqual({ ran: 0, failed: 0 });
    await expect(runGardener((await getGardener(id))!, { generateImpl: generateImpl as never, now: MON })).rejects.toBeInstanceOf(NotClaimedError);
    expect(generateImpl).not.toHaveBeenCalled();
    expect(await runsOf(id)).toBe(0);
    await sql()`update gardeners set enabled = true where id = ${id}`;
    expect(await tick()).toEqual({ ran: 1, failed: 0 });
    expect(await runsOf(id)).toBe(1);
  });
});
