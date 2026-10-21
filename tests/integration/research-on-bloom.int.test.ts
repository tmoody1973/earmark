import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SaveItem } from "../../agent/lib/pipeline/save-item";

// Research on bloom (decision 061) on the Neon `test` branch (TEST_DATABASE_URL, never production); skipped when absent.
// TinyFish, the write model and Bee are fakes: no real network. Run: pnpm test:int tests/integration/research-on-bloom.int.test.ts
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));

const RUN = Date.now() % 1_000_000_000;
const CONV = (n: number) => 9_300_000_000 + RUN * 10 + n;
const unit = (i: number) => Array.from({ length: 1536 }, (_, j) => (j === i ? 1 : 0));
const KEY = { TINYFISH_API_KEY: "tf-test-key", EARMARK_PUBLIC_BASE_URL: "https://earmark.test" };

const mention = (over: Partial<Extract<SaveItem, { kind: "idea" }>>): Extract<SaveItem, { kind: "idea" }> => ({
  kind: "idea", route: "review", extraction: { title: `IT bloom research ${RUN}`, excerpt: "SAID-VERBATIM a CRM for record stores" },
  beeConversationId: null, beeJournalId: null, spokenAt: new Date("2026-10-01T15:00:00Z"), confidence: 0.7, source: "ambient", ...over,
});

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const fetchImpl = vi.fn(async (u: string, init?: RequestInit) => {
  if (u.startsWith("https://api.search.tinyfish.ai")) {
    return json({ query: "q", results: [{ position: 1, title: "Mari", snippet: "s", site_name: "maricopa.gov", url: "https://www.maricopa.gov/mari" }], total_results: 1, page: 0 });
  }
  const urls = (JSON.parse(String(init!.body)) as { urls: string[] }).urls;
  return json({ results: urls.map((x) => ({ url: x, final_url: x, title: null, text: `About ${x}`, published_date: null })), errors: [] });
});
const BRIEF = "**In one line:** The gap is the buyer's side [1].\n\n## What already exists\nMaricopa runs Mari [1].";

describe.skipIf(!process.env.TEST_DATABASE_URL)("research on bloom on the Neon test branch (decision 061)", () => {
  const clusterIds: number[] = [];
  const mods = async () => ({
    ...(await import("../../agent/lib/db")),
    ...(await import("../../agent/lib/pipeline/save-item")),
    ...(await import("../../agent/lib/ideas/research")),
  });
  const save = async (item: SaveItem) => {
    const { db, buildSaveQueries, savedIds } = await mods();
    return savedIds([item], await db().transaction((txn) => buildSaveQueries(txn, item)));
  };
  // Three mentions from three occasions: the third blooms. `askedResearch` puts "include research" on the third save.
  async function bloom(base: number, askedResearch = false) {
    const first = await save(mention({ beeConversationId: CONV(base), spokenAt: new Date("2026-10-15T15:00:00Z"), cluster: { action: "create", embedding: unit(base) } }));
    const id = first.ideaClusterIds[0]!;
    clusterIds.push(id);
    await save(mention({ beeConversationId: CONV(base + 1), spokenAt: new Date("2026-09-12T15:00:00Z"), cluster: { action: "join", clusterId: id, embedding: unit(base) } }));
    const third = await save(mention({ beeConversationId: CONV(base + 2), spokenAt: new Date("2026-10-03T15:00:00Z"), research: askedResearch, cluster: { action: "join", clusterId: id, embedding: unit(base) } }));
    expect(third.bloomedClusterIds).toEqual([id]);
    return id;
  }
  const rows = async (id: number) => {
    const { db } = await mods();
    return db()`select status, attempts, requested_at from idea_research where cluster_id = ${id}`;
  };

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterAll(async () => {
    const { db } = await mods();
    await db()`delete from bee_sync where entity_type = 'idea_research' and entity_id = any(${clusterIds}::bigint[])`;
    for (const id of clusterIds) await db()`delete from idea_clusters where id = ${id}`;
  });

  it("a bloom requests research once; a later mention on the bloomed idea is not a bloom and asks nothing more", async () => {
    const id = await bloom(10);
    const { requestResearchOnBloom } = await mods();
    expect(await requestResearchOnBloom(id, KEY)).toEqual({ requested: true });
    expect(await rows(id)).toHaveLength(1);
    const before = (await rows(id))[0]!;

    const fourth = await save(mention({ beeConversationId: CONV(13), spokenAt: new Date("2026-10-05T15:00:00Z"), cluster: { action: "join", clusterId: id, embedding: unit(10) } }));
    expect(fourth.bloomedClusterIds).toEqual([]); // ingest only requests for bloomedClusterIds
    expect(await requestResearchOnBloom(id, KEY)).toEqual({ requested: false, reason: "already" });
    expect((await rows(id))[0]).toEqual(before);
  });

  it("research the owner already asked for at the third mention is not requested a second time", async () => {
    const id = await bloom(20, true);
    expect(await rows(id)).toHaveLength(1);
    const before = (await rows(id))[0]!;
    const { requestResearchOnBloom } = await mods();
    expect(await requestResearchOnBloom(id, KEY)).toEqual({ requested: false, reason: "already" });
    expect((await rows(id))[0]).toEqual(before);
  });

  it("research that just finished is not asked for again either (recent), and a forgotten idea is refused", async () => {
    const id = await bloom(30);
    const { db, requestResearchOnBloom, requestResearch } = await mods();
    await db()`insert into idea_research (cluster_id, status, requested_at, done_at) values (${id}, 'done', now(), now())`;
    expect(await requestResearchOnBloom(id, KEY)).toEqual({ requested: false, reason: "already" });
    expect(await requestResearch(id)).toEqual({ requested: false, reason: "recent" });
    expect(await requestResearch(2_000_000_000)).toEqual({ requested: false, reason: "missing" });
  });

  it("without TINYFISH_API_KEY nothing is requested and nothing errors", async () => {
    const id = await bloom(40);
    const { requestResearchOnBloom } = await mods();
    expect(await requestResearchOnBloom(id, {})).toEqual({ requested: false, reason: "off" });
    expect(await rows(id)).toHaveLength(0);
  });

  it("the Bee todo for a bloomed idea says it bloomed, and carries the takeaway and the idea link", async () => {
    const id = await bloom(50);
    const { requestResearchOnBloom, runIdeaResearch } = await mods();
    await requestResearchOnBloom(id, KEY);
    const notify = vi.fn(async () => ({ id: 1 }) as never);
    const run = await runIdeaResearch({ env: KEY, fetchImpl: fetchImpl as never, generateImpl: (async () => ({ text: BRIEF })) as never, model: "m", notify, onlyIds: [id] });
    expect(run).toMatchObject({ status: "done", done: 1, notified: 1 });
    const text = (notify.mock.calls[0] as unknown as [{ text: string }])[0].text;
    expect(text).toBe(`Earmark · 'IT bloom research ${RUN}' bloomed: draft and research ready — The gap is the buyer's side. https://earmark.test/ideas/${id}`);
    expect(text).not.toContain("SAID-VERBATIM");
  });
});
