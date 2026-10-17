import { del } from "@vercel/blob";
import { createBeeClient } from "../bee/client";
import { db } from "../db";
import { getClusterTimeline } from "../store/ideas";
import { trashNotionPage } from "../notion/client";

// FR-30: forget one rec, idea or mention everywhere. External deletes (Bee, Notion, Blob) run first; any failure other
// than 404 stops before Postgres, so the database still holds every reference and the command can be re-run.
export type ForgetTarget = { type: "rec" | "idea" | "mention"; id: number };
export type ForgetStep =
  | { kind: "bee_todo" | "bee_fact"; beeId: number }
  | { kind: "notion_page"; pageId: string }
  | { kind: "blob"; url: string }
  | { kind: "db"; target: ForgetTarget };
export interface ForgetRefs { exists: boolean; beeTodoIds: number[]; beeFactIds: number[]; notionPageIds: string[]; blobUrls: string[] }
export interface ForgetDeps {
  deleteTodo(id: number): Promise<void>;
  deleteFact(id: number): Promise<void>;
  trashNotionPage(pageId: string): Promise<void>;
  deleteBlob(url: string): Promise<void>;
  deleteRows(target: ForgetTarget): Promise<void>;
}

type Row = Record<string, unknown>;
const values = (rows: Row[], key: string) => rows.map((r) => r[key]).filter((v) => v != null);
const uniqueNumbers = (vs: unknown[]) => [...new Set(vs.map(Number))];
const uniqueStrings = (vs: unknown[]) => [...new Set(vs.map(String))];

// notion_sync arrives with M3-T1 (migration 010); until then the page id lives only on the item row.
async function hasNotionSync(): Promise<boolean> {
  const rows = await db()`select to_regclass('public.notion_sync') is not null as ok`;
  return rows[0]?.ok === true;
}

export async function loadForgetRefs(t: ForgetTarget): Promise<ForgetRefs> {
  const none = { beeTodoIds: [], beeFactIds: [], notionPageIds: [], blobUrls: [] };
  if (t.type === "mention") {
    const rows = await db()`select 1 from idea_mentions where id = ${t.id}`;
    return { exists: rows.length > 0, ...none };
  }
  const item = t.type === "rec"
    ? await db()`select bee_todo_id, null as bee_fact_id, notion_page_id from recommendations where id = ${t.id}`
    : await db()`select null as bee_todo_id, bee_fact_id, notion_page_id from idea_clusters where id = ${t.id}`;
  if (item.length === 0) return { exists: false, ...none };
  const sync = await db()`select bee_object, bee_id from bee_sync where entity_type = ${t.type} and entity_id = ${t.id}`;
  const notion = (await hasNotionSync())
    ? await db()`select page_id from notion_sync where entity_type = ${t.type} and entity_id = ${t.id}`
    : [];
  const receipts = t.type === "rec"
    ? await db()`select bee_todo_id from rec_receipts where recommendation_id = ${t.id} and bee_todo_id is not null`
    : [];
  const photos = t.type === "rec"
    ? await db()`select thumbnail_url from photos where recommendation_id = ${t.id} and thumbnail_url is not null`
    : [];
  return {
    exists: true,
    beeTodoIds: uniqueNumbers([
      ...values(item, "bee_todo_id"), ...values(sync.filter((r) => r.bee_object === "todo"), "bee_id"), ...values(receipts, "bee_todo_id"),
    ]),
    beeFactIds: uniqueNumbers([...values(item, "bee_fact_id"), ...values(sync.filter((r) => r.bee_object === "fact"), "bee_id")]),
    notionPageIds: uniqueStrings([...values(item, "notion_page_id"), ...values(notion, "page_id")]),
    blobUrls: uniqueStrings(values(photos, "thumbnail_url")),
  };
}

export function planForget(target: ForgetTarget, refs: ForgetRefs): ForgetStep[] {
  if (!refs.exists) return [];
  return [
    ...refs.beeTodoIds.map((beeId) => ({ kind: "bee_todo" as const, beeId })),
    ...refs.beeFactIds.map((beeId) => ({ kind: "bee_fact" as const, beeId })),
    ...refs.notionPageIds.map((pageId) => ({ kind: "notion_page" as const, pageId })),
    ...refs.blobUrls.map((url) => ({ kind: "blob" as const, url })),
    { kind: "db", target },
  ];
}

const gone = (err: unknown) => (err as { status?: number })?.status === 404;

export async function executeForget(steps: ForgetStep[], deps: ForgetDeps): Promise<string[]> {
  const log: string[] = [];
  for (const step of steps) {
    try {
      if (step.kind === "bee_todo") await deps.deleteTodo(step.beeId);
      if (step.kind === "bee_fact") await deps.deleteFact(step.beeId);
      if (step.kind === "notion_page") await deps.trashNotionPage(step.pageId);
      if (step.kind === "blob") await deps.deleteBlob(step.url);
      if (step.kind === "db") await deps.deleteRows(step.target);
      log.push(`deleted ${JSON.stringify(step)}`);
    } catch (err) {
      if (step.kind !== "db" && gone(err)) {
        log.push(`already gone ${JSON.stringify(step)}`);
        continue;
      }
      throw err;
    }
  }
  return log;
}

// links and space_items have no foreign keys, so they are deleted here; photos, rec_receipts, idea_mentions and
// garden_events cascade from their parent row.
export async function deleteRows(t: ForgetTarget): Promise<void> {
  if (t.type === "mention") return deleteMention(t.id);
  const sql = db();
  const key = String(t.id);
  const withNotionSync = await hasNotionSync();
  const shared = () => [
    sql`delete from links where (from_type = ${t.type} and from_id = ${key}) or (to_type = ${t.type} and to_id = ${key})`,
    sql`delete from space_items where item_type = ${t.type} and item_id = ${t.id}`,
    sql`delete from bee_sync where entity_type = ${t.type} and entity_id = ${t.id}`,
    ...(withNotionSync ? [sql`delete from notion_sync where entity_type = ${t.type} and entity_id = ${t.id}`] : []),
  ];
  if (t.type === "idea") {
    await sql.transaction([...shared(), sql`delete from idea_clusters where id = ${t.id}`]);
    return;
  }
  const rows = await sql`select recommender_id from recommendations where id = ${t.id}`;
  const rid = rows[0]?.recommender_id == null ? null : Number(rows[0].recommender_id);
  // The recommender's first name was stored for their recs only: it goes with their last one, otherwise recount.
  const recommender = rid == null ? [] : [
    sql`delete from links where ((from_type = 'recommender' and from_id = ${String(rid)}) or (to_type = 'recommender' and to_id = ${String(rid)}))
          and not exists (select 1 from recommendations where recommender_id = ${rid})`,
    sql`update recommenders p set
          recs_given = (select count(*) from recommendations r where r.recommender_id = p.id),
          recs_tried = (select count(*) from recommendations r where r.recommender_id = p.id and r.status in ('tried','thanked')),
          recs_loved = (select count(*) from recommendations r where r.recommender_id = p.id and r.rating = 'loved')
        where p.id = ${rid}`,
    sql`delete from recommenders where id = ${rid} and not exists (select 1 from recommendations where recommender_id = ${rid})`,
  ];
  await sql.transaction([...shared(), sql`delete from recommendations where id = ${t.id}`, ...recommender]);
}

// One mention leaves its idea: drop the timeline line written for it (paired by spoken_at, see growthSteps) and
// recompute the counts, stage and centroid from the mentions that remain.
async function deleteMention(id: number): Promise<void> {
  const sql = db();
  const rows = await sql`delete from idea_mentions where id = ${id} returning cluster_id, spoken_at`;
  if (!rows[0]) return;
  const clusterId = Number(rows[0].cluster_id);
  const spokenAt = new Date(rows[0].spoken_at as string | Date).getTime();
  const timeline = [...(await getClusterTimeline(clusterId))];
  const at = timeline.findIndex((e) => Date.parse(e.date) === spokenAt);
  if (at !== -1) timeline.splice(at, 1);
  await sql`
    update idea_clusters c set
      mention_count = s.n,
      first_mentioned_at = s.first,
      last_mentioned_at = s.last,
      stage = idea_stage_for(c.stage, s.n),
      centroid = s.centroid,
      timeline = ${JSON.stringify(timeline)}::jsonb,
      updated_at = now()
    from (
      select count(*)::int as n, min(spoken_at) as first, max(spoken_at) as last,
             avg(embedding) filter (where review_status <> 'dismissed') as centroid
      from idea_mentions where cluster_id = ${clusterId}
    ) s
    where c.id = ${clusterId}`;
}

// An idea with no mentions left is empty, so forgetting its last mention forgets the idea (and its Notion page, Bee fact).
async function resolveTarget(t: ForgetTarget): Promise<{ target: ForgetTarget; note?: string }> {
  if (t.type !== "mention") return { target: t };
  const rows = await db()`
    select m.cluster_id, (select count(*)::int from idea_mentions o where o.cluster_id = m.cluster_id) as n
    from idea_mentions m where m.id = ${t.id}`;
  if (!rows[0] || Number(rows[0].n) > 1) return { target: t };
  const idea = { type: "idea" as const, id: Number(rows[0].cluster_id) };
  return { target: idea, note: `mention ${t.id} is the last mention of idea ${idea.id}: forgetting the idea` };
}

export async function forget(input: ForgetTarget, opts: { dryRun?: boolean } = {}): Promise<string[]> {
  const { target, note } = await resolveTarget(input);
  const steps = planForget(target, await loadForgetRefs(target));
  if (steps.length === 0) return [`nothing to forget for ${input.type} ${input.id}`];
  const head = note ? [note] : [];
  if (opts.dryRun) return [...head, ...steps.map((s) => `would delete ${JSON.stringify(s)}`)];
  const bee = createBeeClient();
  const log = await executeForget(steps, {
    deleteTodo: bee.deleteTodo,
    deleteFact: bee.deleteFact,
    trashNotionPage,
    deleteBlob: del,
    deleteRows,
  });
  return [...head, ...log];
}
