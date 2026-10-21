import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool, type PoolClient } from "@neondatabase/serverless";

// Shows nearby (decision 064) on the Neon `test` branch (TEST_DATABASE_URL, never production). TinyFish, Nominatim, the
// model and Bee are fakes: no request leaves the test. Sweeps are scoped to this file's rows (onlyIds).
const ENV = { TINYFISH_API_KEY: "tf-test-key", EARMARK_HOME_LAT: "43.04", EARMARK_HOME_LNG: "-87.91", BEE_TODO_WRITES: "on",
  EARMARK_PUBLIC_BASE_URL: "https://earmark.test" };
const RUN = String(Date.now() % 1_000_000); // a fresh artist each run: a show is told once across tips, ever
const SECRET = "SECRET EXCERPT Ann said they are amazing live";
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const SHOW_DAY = day(10);

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
function fakeNet() {
  return vi.fn(async (url: string) => {
    if (url.startsWith("https://api.search.tinyfish.ai")) {
      return json({ results: [{ title: "IT Band tour dates", snippet: "Cactus Club, Milwaukee", site_name: "songkick.com", url: "https://www.songkick.com/it-band" }] });
    }
    if (url.includes("/reverse?")) return json({ name: "Milwaukee", address: { state: "Wisconsin" } });
    return json([]); // Nominatim search: no other city is near
  });
}
const model = () => vi.fn(async () => ({ output: { shows: [
  { date: SHOW_DAY, venue: "Cactus Club", city: "Milwaukee, WI", result: 1 },
  { date: SHOW_DAY, venue: "Somewhere Far", city: "Portland, OR", result: 1 },
  { date: null, venue: "Mystery Hall", city: "Milwaukee, WI", result: 1 },
] } }));

type T = { id: number; text: string; completed: boolean; alarm_at: string | null };
function fakeBee() {
  const todos = new Map<number, T>();
  let next = 8_000_000 + Math.floor(Math.random() * 1_000_000);
  return {
    todos,
    listTodos: vi.fn(async () => ({ todos: [...todos.values()], next_cursor: null })),
    createTodo: vi.fn(async ({ text, alarmAt }: { text: string; alarmAt?: string | null }) => {
      const id = next++;
      todos.set(id, { id, text, completed: false, alarm_at: alarmAt ?? null });
      return { id };
    }),
    updateTodo: vi.fn(async (id: number, patch: Partial<T>) => { todos.set(id, { ...todos.get(id)!, ...patch }); }),
    deleteTodo: vi.fn(async () => {}),
    getTodo: vi.fn(async (id: number) => todos.get(id)!),
  };
}

describe.skipIf(!process.env.TEST_DATABASE_URL)("shows nearby in the rec lane (decision 064)", () => {
  let pool: Pool;
  let c: PoolClient;
  const ids: number[] = [];
  const quiet = { summarize: vi.fn(async () => null), beeSummary: vi.fn(async () => null), embedRecs: vi.fn(async () => 0),
    about: vi.fn(async () => null), extras: vi.fn(async () => ({})), enrich: vi.fn(async () => null), pick: vi.fn(async () => null) };
  const sweep = async (id: number, o: { net: ReturnType<typeof fakeNet>; gen: ReturnType<typeof model>; bee: ReturnType<typeof fakeBee> }) =>
    (await import("../../agent/lib/recs/lane")).sweepRecLane({ ...quiet, env: ENV, onlyIds: [id], bee: o.bee,
      showsFetch: o.net as unknown as typeof fetch, showsGenerate: o.gen as never });
  const addArtist = async (name: string, status = "new", type = "artist", creator: string | null = null) => {
    const { rows } = await c.query(
      `insert into recommendations (type, raw_text, canonical_name, creator, excerpt, said_at, source, status, confidence,
         enrichment_status, match_source, enriched_at, about_at, extras_at)
       values ($3, $2, $4, $5, $2, now(), 'ambient', $1, 0.9, 'matched', 'auto', now(), now(), now()) returning id`,
      [status, SECRET, type, name, creator]);
    ids.push(Number(rows[0].id));
    return Number(rows[0].id);
  };
  const shows = async (id: number) => (await c.query(`select extras->'shows' as shows from recommendations where id = $1`, [id])).rows[0].shows;
  const todoRows = async (id: number) => (await c.query(
    `select bee_id from bee_sync where entity_type = 'show' and entity_id = $1 and bee_object = 'todo'`, [id])).rows;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    c = await pool.connect();
  });
  afterAll(async () => {
    if (!c) return;
    await c.query(`delete from bee_sync where entity_type = 'show' and entity_id = any($1::bigint[])`, [ids]);
    await c.query(`delete from recommendations where id = any($1::bigint[])`, [ids]);
    await c.query(`delete from sync_cursors where name = 'rec_lane_lease'`);
    c.release();
    await pool.end();
  });

  it("a pass stores the nearby show (dated, with a venue and its source) and makes one todo in derived words", async () => {
    const id = await addArtist(`IT Band ${RUN}`);
    const o = { net: fakeNet(), gen: model(), bee: fakeBee() };
    expect(await sweep(id, o)).toMatchObject({ status: "done", showChecks: 1, showTodos: 1 });
    const s = await shows(id);
    expect(s.items).toEqual([{ date: SHOW_DAY, venue: "Cactus Club", city: "Milwaukee, WI", url: "https://www.songkick.com/it-band" }]);
    expect(Date.now() - Date.parse(s.checkedAt)).toBeLessThan(60_000);
    expect(o.bee.createTodo).toHaveBeenCalledTimes(1);
    const [{ text, alarmAt }] = o.bee.createTodo.mock.calls[0]!;
    expect(text).toMatch(new RegExp(`^Earmark · IT Band ${RUN} plays Cactus Club \\w{3} \\w{3} \\d{1,2} https://earmark.test/tips/${id}$`));
    expect(alarmAt).toBe(`${day(9)}T15:00:00.000Z`);
    const search = new URL(String(o.net.mock.calls.find((call) => String(call[0]).includes("tinyfish"))![0]));
    expect(search.searchParams.get("query")).toBe(`IT Band ${RUN} tour dates Milwaukee, Wisconsin`);
    expect(JSON.stringify([o.net.mock.calls, o.gen.mock.calls, o.bee.createTodo.mock.calls])).not.toMatch(/SECRET|Ann/);
    expect(await todoRows(id)).toHaveLength(1);
  });

  it("a second pass the same day does nothing; the next day's check tells the same show no second time", async () => {
    const id = await addArtist(`IT Duo ${RUN}`);
    const o = { net: fakeNet(), gen: model(), bee: fakeBee() };
    await sweep(id, o);
    expect(o.bee.createTodo).toHaveBeenCalledTimes(1);
    const searches = () => o.net.mock.calls.filter((call) => String(call[0]).includes("tinyfish")).length;
    expect(await sweep(id, o)).toMatchObject({ showChecks: 0, showTodos: 0 });
    expect(searches()).toBe(1);
    await c.query(`update recommendations set extras = jsonb_set(extras, '{shows,checkedAt}', to_jsonb((now() - interval '25 hours')::text)) where id = $1`, [id]);
    expect(await sweep(id, o)).toMatchObject({ showChecks: 1, showTodos: 0 });
    expect(searches()).toBe(2);
    expect(o.bee.createTodo).toHaveBeenCalledTimes(1);
    expect(o.bee.updateTodo).not.toHaveBeenCalled();
  });

  it("a dismissed tip is never looked up", async () => {
    const id = await addArtist(`IT Trio ${RUN}`, "dismissed");
    const o = { net: fakeNet(), gen: model(), bee: fakeBee() };
    expect(await sweep(id, o)).toMatchObject({ showChecks: 0, showTodos: 0 });
    expect(o.net).not.toHaveBeenCalled();
    expect(await shows(id)).toBeNull();
  });

  it("an album by an artist whose show was already told makes no second todo for it", async () => {
    const artist = await addArtist(`IT Quartet ${RUN}`);
    const album = await addArtist("IT Album", "new", "album", `it quartet ${RUN}`);
    const o = { net: fakeNet(), gen: model(), bee: fakeBee() };
    expect(await sweep(artist, o)).toMatchObject({ showTodos: 1 });
    expect(await sweep(album, o)).toMatchObject({ showChecks: 1, showTodos: 0 });
    expect(o.bee.createTodo).toHaveBeenCalledTimes(1);
    expect((await shows(album)).items).toHaveLength(1); // the page still lists it
    expect(await todoRows(album)).toHaveLength(0);
  });
});
