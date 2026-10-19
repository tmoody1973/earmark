import { afterAll, describe, expect, it } from "vitest";
import type { SaveItem } from "../../agent/lib/pipeline/save-item";

// Quiet ideas (decision 055) on the Neon `test` branch: needs TEST_DATABASE_URL (never production). Skipped when absent.
// An idea overheard once stays out of the garden until it recurs; Heard once lists it; Keep, Dismiss and Undo.
// Run: pnpm test:int tests/integration/quiet-ideas.int.test.ts
const RUN = Date.now() % 1_000_000_000;
const CONV = (n: number) => 9_300_000_000 + RUN * 10 + n;
const DIM = 700 + (RUN % 500);
const unit = (i: number) => Array.from({ length: 1536 }, (_, j) => (j === i ? 1 : 0));
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000);

type IdeaItem = Extract<SaveItem, { kind: "idea" }>;
const idea = (title: string, over: Partial<IdeaItem> = {}): IdeaItem => ({
  kind: "idea", route: "accept", extraction: { title: `IT: quiet ${title}`, excerpt: `an excerpt about ${title}` },
  beeConversationId: CONV(Math.floor(Math.random() * 9)), beeJournalId: null, spokenAt: ago(60), confidence: 0.9, source: "ambient", ...over,
});

describe.skipIf(!process.env.TEST_DATABASE_URL)("quiet ideas on the Neon test branch", () => {
  const since = new Date(Date.now() - 1000);
  let conv = 0;
  const mods = async () => ({
    ...(await import("../../agent/lib/db")),
    ...(await import("../../agent/lib/pipeline/save-item")),
    ...(await import("../../agent/lib/garden/queries")),
    ...(await import("../../agent/lib/garden/quiet-ideas")),
    ...(await import("../../agent/lib/store/garden-events")),
    ...(await import("../../agent/lib/gardeners/run")),
  });
  const save = async (item: IdeaItem) => {
    const { db, buildSaveQueries, savedIds } = await mods();
    return savedIds([item], await db().transaction((txn) => buildSaveQueries(txn, item)));
  };
  // A new idea from its own conversation; `over` makes it deliberate or a voice note.
  const create = async (title: string, over: Partial<IdeaItem> = {}) =>
    (await save(idea(title, { beeConversationId: CONV(++conv), cluster: { action: "create", embedding: unit(DIM) }, ...over }))).ideaClusterIds[0]!;
  const mention = async (id: number) =>
    save(idea("again", { beeConversationId: CONV(++conv), spokenAt: ago(5), cluster: { action: "join", clusterId: id, embedding: unit(DIM) } }));
  const quiet = async (id: number) => {
    const { db } = await mods();
    return Boolean((await db()`select idea_is_quiet(${id}::bigint) as q`)[0]!.q);
  };
  const row = async (id: number) => {
    const { db } = await mods();
    return (await db()`select stage, mention_count, kept_at, pinned from idea_clusters where id = ${id}`)[0]!;
  };
  const inGarden = async (id: number) => (await (await mods()).getPlants()).some((p) => p.id === id);
  const inHeardOnce = async (id: number) => (await (await mods()).getHeardOnce()).some((i) => i.id === id);

  afterAll(async () => {
    const { db } = await mods();
    await db()`delete from idea_clusters where title like 'IT: quiet %'`;
  });

  it("the rule: one overheard mention is quiet; deliberate, voice note, pinned, mention-less and dismissed are not", async () => {
    const { db } = await mods();
    expect(await quiet(await create("ambient once"))).toBe(true);
    expect(await quiet(await create("earmark that", { deliberateKey: `it-quiet-${RUN}` }))).toBe(false);
    expect(await quiet(await create("voice note", { beeConversationId: null, beeJournalId: `it-quiet-${RUN}`, source: "voice", confidence: 1 }))).toBe(false);
    const pinned = await create("pinned");
    await db()`update idea_clusters set pinned = true where id = ${pinned}`;
    expect(await quiet(pinned)).toBe(false);
    const [bare] = await db()`insert into idea_clusters (title, stage, mention_count) values ('IT: quiet no mentions', 'compost', 1) returning id`;
    expect(await quiet(Number(bare!.id))).toBe(false); // a fixture or legacy row with no mention rows stays visible
    const gone = await create("dismissed");
    await db()`update idea_clusters set stage = 'dismissed' where id = ${gone}`;
    expect(await quiet(gone)).toBe(false); // hidden by the garden's own rule, never listed as heard once
    expect(await inHeardOnce(gone)).toBe(false);
  });

  it("an overheard idea is saved but quiet; its second occasion shows it; its third blooms (the live path unchanged)", async () => {
    const { listGardenEventsSince, loadGardenerData, getHeardOnce } = await mods();
    const id = await create("crate digging hour");
    expect(await row(id)).toMatchObject({ stage: "compost", mention_count: 1 });
    expect(await inGarden(id)).toBe(false);
    expect((await loadGardenerData(["ideas"])).ideas!.some((i) => i.title === "IT: quiet crate digging hour")).toBe(false);
    expect((await listGardenEventsSince(since)).some((e) => e.clusterId === id)).toBe(false); // no live refresh for it
    const listed = (await getHeardOnce()).find((i) => i.id === id);
    expect(listed).toMatchObject({ title: "IT: quiet crate digging hour", excerpt: "an excerpt about crate digging hour" });
    expect(Date.parse(listed!.heardAt)).not.toBeNaN();

    await mention(id);
    expect(await row(id)).toMatchObject({ stage: "sprouting", mention_count: 2 });
    expect(await inGarden(id)).toBe(true);
    expect(await inHeardOnce(id)).toBe(false);
    expect((await listGardenEventsSince(since)).filter((e) => e.clusterId === id).map((e) => e.kind)).toEqual(["mention", "mention"]);

    const third = await mention(id);
    expect(third.bloomedClusterIds).toEqual([id]);
    expect(await row(id)).toMatchObject({ stage: "ready", mention_count: 3 });
    expect((await listGardenEventsSince(since)).filter((e) => e.clusterId === id).at(-1)).toMatchObject({ kind: "bloom", stage: "ready", mentionCount: 3 });
  });

  it("deliberate ideas always show", async () => {
    const id = await create("said earmark that", { deliberateKey: `it-quiet-show-${RUN}` });
    expect(await inGarden(id)).toBe(true);
    expect(await inHeardOnce(id)).toBe(false);
  });

  it("Keep shows a quiet idea now, once; it does nothing to an idea that is not quiet", async () => {
    const { keepIdea } = await mods();
    const id = await create("kept one");
    expect(await keepIdea(id)).toBe(true);
    expect((await row(id)).kept_at).not.toBeNull();
    expect(await inGarden(id)).toBe(true);
    expect(await inHeardOnce(id)).toBe(false);
    expect(await keepIdea(id)).toBe(false); // idempotent
    expect(await keepIdea(await create("loud one", { deliberateKey: `it-quiet-keep-${RUN}` }))).toBe(false);
  });

  it("Dismiss and Undo: idempotent, back to where it was, only within the hour, never a merge's dismissal", async () => {
    const { db, dismissIdea, undoDismissIdea } = await mods();
    const id = await create("tv noise");
    expect(await dismissIdea(id)).toEqual({ changed: true, previous: "compost" });
    expect(await row(id)).toMatchObject({ stage: "dismissed" });
    expect(await inHeardOnce(id)).toBe(false);
    expect(await dismissIdea(id)).toEqual({ changed: false, previous: null });
    expect(await undoDismissIdea(id, "compost")).toBe(true);
    expect(await row(id)).toMatchObject({ stage: "compost" });
    expect(await inHeardOnce(id)).toBe(true); // back where it was: still quiet
    expect(await undoDismissIdea(id, "compost")).toBe(false);

    // A drafted idea can be dismissed too, and Undo puts the draft back as drafted.
    const drafted = await create("drafted one", { deliberateKey: `it-quiet-drafted-${RUN}` });
    await db()`update idea_clusters set stage = 'drafted', draft_md = 'a draft' where id = ${drafted}`;
    expect(await dismissIdea(drafted)).toEqual({ changed: true, previous: "drafted" });
    expect(await inGarden(drafted)).toBe(false);
    expect(await undoDismissIdea(drafted, "drafted")).toBe(true);
    expect(await row(drafted)).toMatchObject({ stage: "drafted" });

    // A growth stage is recounted, never taken on trust: one mention comes back as compost, whatever the page says.
    const once = await create("recounted", { deliberateKey: `it-quiet-recount-${RUN}` });
    await dismissIdea(once);
    expect(await undoDismissIdea(once, "ready")).toBe(true);
    expect(await row(once)).toMatchObject({ stage: "compost" });

    // Past the hour, Undo is refused.
    await dismissIdea(once);
    await db()`update idea_clusters set updated_at = now() - interval '2 hours' where id = ${once}`;
    expect(await undoDismissIdea(once, "compost")).toBe(false);
    expect(await row(once)).toMatchObject({ stage: "dismissed" });

    // A merge's dismissal is undone by undoMerge only.
    const merged = await create("merged away", { deliberateKey: `it-quiet-merged-${RUN}` });
    await db()`update idea_clusters set stage = 'dismissed', updated_at = now() where id = ${merged}`;
    await db()`insert into idea_merges (keep_id, merged_id, mention_ids, keep_before, merged_before, token)
      values (${drafted}, ${merged}, '{}', '{}'::jsonb, '{}'::jsonb, gen_random_uuid())`;
    expect(await undoDismissIdea(merged, "compost")).toBe(false);
  });

  it("a dismissed idea mentioned again stays dismissed (compost.ts keeps it so)", async () => {
    const { dismissIdea } = await mods();
    const id = await create("dismissed then heard");
    await dismissIdea(id);
    await mention(id);
    expect(await row(id)).toMatchObject({ stage: "dismissed", mention_count: 2 });
    expect(await inGarden(id)).toBe(false);
    expect(await inHeardOnce(id)).toBe(false);
  });
});
