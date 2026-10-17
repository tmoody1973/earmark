// FR-30 (M3-T11): forget one rec, idea or mention everywhere. Adapted from PostHog draft PR #8; decision 011.
// Order: the outside copies first (Bee todos/facts, Notion page, Blob thumbnails; a 404 means already gone), then every
// Postgres row in ONE locked transaction, then other lanes' hooks. Any other outside failure (or an unconfigured service
// that has refs) aborts BEFORE Postgres, so the refs are still there and re-running the command retries safely.
// Logs and plans carry ids and counts only, never text.
import { del } from "@vercel/blob";
import type { PoolClient } from "@neondatabase/serverless";
import { createBeeClient, type BeeClient } from "../bee/client";
import { inTransaction } from "../db";

export type ForgetTarget = { type: "rec" | "idea" | "mention"; id: number };
export interface ForgetRefs { beeTodoIds: number[]; beeFactIds: number[]; notionPageIds: string[]; blobUrls: string[] }
export type ForgetStep =
  | { kind: "bee_todo" | "bee_fact"; beeId: number }
  | { kind: "notion_page"; pageId: string }
  | { kind: "blob"; url: string; n?: number }
  | { kind: "db"; target: ForgetTarget };
export interface ForgetPlan {
  target: ForgetTarget;
  resolved: ForgetTarget; // the idea, when the mention asked for is its idea's last
  exists: boolean;
  deletes: Record<string, number>; // rows removed per table (cascades included)
  updates: Record<string, number>; // rows recomputed per table
  refs: ForgetRefs;
  recommender: { id: number; firstName: string; removed: boolean } | null; // firstName is for hooks only, never printed
}
// null = that service is not configured: a step that needs it is skipped, said so, and aborts before Postgres.
export interface ExternalDeps {
  deleteTodo(id: number): Promise<void>;
  deleteFact(id: number): Promise<void>;
  trashNotionPage: ((pageId: string) => Promise<void>) | null;
  deleteBlob: ((url: string) => Promise<void>) | null;
}
export interface ForgetDeps extends ExternalDeps { deleteRows(target: ForgetTarget): Promise<void> }
// Other lanes' forgetters (lane C: M5 episodes, gardener runs), listed in forget-hooks.ts. Run after the commit;
// `run` returns one log line of ids/counts (never text); a throw is reported and counted.
export interface ForgetHookContext { target: ForgetTarget; recommenderFirstName: string | null; recommenderRemoved: boolean }
export interface ForgetHook { name: string; run(ctx: ForgetHookContext): Promise<string> }
export interface ForgetResult { plan: ForgetPlan; lines: string[]; incomplete: number; aborted: boolean } // aborted = Postgres untouched

// An outside step failed (or its service is not configured): nothing in Postgres was touched. `lines` = what was done
// plus the failing id with err.name; the message is the cause's and is never printed.
export class ForgetAbortedError extends Error {
  override name = "ForgetAbortedError";
  constructor(readonly lines: string[], cause: unknown) {
    super(cause instanceof Error ? cause.message : "outside delete not done", { cause });
  }
}
// The locked re-read found outside refs the outside pass did not cover (one was added meanwhile): rolled back.
export class ForgetRefsChangedError extends Error {
  override name = "ForgetRefsChangedError";
}

const NONE: ForgetRefs = { beeTodoIds: [], beeFactIds: [], notionPageIds: [], blobUrls: [] };
const nums = (vs: unknown[]) => [...new Set(vs.filter((v) => v != null).map(Number))];
const strs = (vs: unknown[]) => [...new Set(vs.filter((v) => v != null).map(String))];

async function rows(c: PoolClient, text: string, values: unknown[]): Promise<Record<string, unknown>[]> {
  return (await c.query(text, values)).rows;
}
async function count(c: PoolClient, from: string, values: unknown[]): Promise<number> {
  return Number((await rows(c, `select count(*)::int as n from ${from}`, values))[0]!.n);
}

// links/space_items/bee_sync have no foreign keys, so they are matched by (type, id) and deleted explicitly.
const LINKS = `links where (from_type = $1 and from_id = $2) or (to_type = $1 and to_id = $2)`;
const RECOMMENDER_LINKS = `links where (from_type = 'recommender' and from_id = $1) or (to_type = 'recommender' and to_id = $1)`;
async function shared(c: PoolClient, type: "rec" | "idea", id: number) {
  const sync = await rows(c, `select bee_object, bee_id from bee_sync where entity_type = $1 and entity_id = $2`, [type, id]);
  return {
    links: await count(c, LINKS, [type, String(id)]),
    space_items: await count(c, `space_items where item_type = $1 and item_id = $2`, [type, id]),
    bee_sync: sync.length,
    todos: sync.filter((r) => r.bee_object === "todo").map((r) => r.bee_id),
    facts: sync.filter((r) => r.bee_object === "fact").map((r) => r.bee_id),
  };
}

async function planRec(c: PoolClient, target: ForgetTarget, lock: string): Promise<ForgetPlan> {
  const [r] = await rows(c, `
    select r.bee_todo_id, r.notion_page_id, r.recommender_id, p.first_name,
           (select count(*)::int from recommendations o where o.recommender_id = r.recommender_id and o.id <> r.id) as others
    from recommendations r left join recommenders p on p.id = r.recommender_id where r.id = $1${lock}`, [target.id]);
  if (!r) return { target, resolved: target, exists: false, deletes: {}, updates: {}, refs: NONE, recommender: null };
  const receipts = await rows(c, `select bee_todo_id from rec_receipts where recommendation_id = $1`, [target.id]);
  const photos = await rows(c, `select thumbnail_url from photos where recommendation_id = $1`, [target.id]);
  const s = await shared(c, "rec", target.id);
  const recommender = r.recommender_id == null ? null
    : { id: Number(r.recommender_id), firstName: String(r.first_name), removed: Number(r.others) === 0 };
  // The recommender's first name was kept for their recs only: it goes with their last one (and its links).
  const links = recommender?.removed
    ? await count(c, `links where (from_type = 'rec' and from_id = $1) or (to_type = 'rec' and to_id = $1)
                        or (from_type = 'recommender' and from_id = $2) or (to_type = 'recommender' and to_id = $2)`,
      [String(target.id), String(recommender.id)])
    : s.links;
  return {
    target, resolved: target, exists: true, recommender,
    deletes: {
      recommendations: 1, rec_receipts: receipts.length, photos: photos.length, links, space_items: s.space_items,
      bee_sync: s.bee_sync, resort_backup: await count(c, `resort_backup where table_name = 'recommendations' and row_id = $1`, [target.id]),
      recommenders: recommender?.removed ? 1 : 0,
    },
    updates: recommender && !recommender.removed ? { recommenders: 1 } : {},
    refs: {
      beeTodoIds: nums([r.bee_todo_id, ...s.todos, ...receipts.map((x) => x.bee_todo_id)]),
      beeFactIds: nums(s.facts),
      notionPageIds: strs([r.notion_page_id]),
      blobUrls: strs(photos.map((x) => x.thumbnail_url)),
    },
  };
}

async function planIdea(c: PoolClient, target: ForgetTarget, resolved: ForgetTarget, lock: string): Promise<ForgetPlan> {
  const [k] = await rows(c, `select bee_fact_id, notion_page_id from idea_clusters where id = $1${lock}`, [resolved.id]);
  if (!k) return { target, resolved, exists: false, deletes: {}, updates: {}, refs: NONE, recommender: null };
  const s = await shared(c, "idea", resolved.id);
  return {
    target, resolved, exists: true, recommender: null, updates: {},
    deletes: {
      idea_clusters: 1,
      idea_mentions: await count(c, `idea_mentions where cluster_id = $1`, [resolved.id]),
      garden_events: await count(c, `garden_events where cluster_id = $1`, [resolved.id]),
      links: s.links, space_items: s.space_items, bee_sync: s.bee_sync,
      resort_backup: await count(c, `resort_backup where (table_name = 'idea_clusters' and row_id = $1)
        or (table_name = 'idea_mentions' and row_id in (select id from idea_mentions where cluster_id = $1))`, [resolved.id]),
    },
    refs: { ...NONE, beeTodoIds: nums(s.todos), beeFactIds: nums([k.bee_fact_id, ...s.facts]), notionPageIds: strs([k.notion_page_id]) },
  };
}

// A mention leaves its idea; the last mention of an idea forgets the whole idea (title, Bee fact, Notion page).
async function planMention(c: PoolClient, target: ForgetTarget, lock: string): Promise<ForgetPlan> {
  const [m] = await rows(c, `select cluster_id from idea_mentions where id = $1`, [target.id]);
  if (!m) return { target, resolved: target, exists: false, deletes: {}, updates: {}, refs: NONE, recommender: null };
  const clusterId = Number(m.cluster_id);
  await rows(c, `select id from idea_clusters where id = $1${lock}`, [clusterId]); // locks the idea before counting
  if (await count(c, `idea_mentions where cluster_id = $1`, [clusterId]) <= 1) {
    return planIdea(c, target, { type: "idea", id: clusterId }, lock);
  }
  return {
    target, resolved: target, exists: true, recommender: null, refs: NONE,
    deletes: { idea_mentions: 1, resort_backup: await count(c, `resort_backup where table_name = 'idea_mentions' and row_id = $1`, [target.id]) },
    updates: { idea_clusters: 1 },
  };
}

export async function readPlan(c: PoolClient, target: ForgetTarget, lock: boolean): Promise<ForgetPlan> {
  const forUpdate = lock ? " for update" : "";
  if (target.type === "rec") return planRec(c, target, forUpdate.replace("update", "update of r"));
  if (target.type === "idea") return planIdea(c, target, target, forUpdate);
  return planMention(c, target, forUpdate);
}

export async function deleteRows(c: PoolClient, plan: ForgetPlan): Promise<void> {
  const { type, id } = plan.resolved;
  if (type === "mention") return deleteMention(c, id);
  await c.query(`delete from ${LINKS}`, [type, String(id)]);
  await c.query(`delete from space_items where item_type = $1 and item_id = $2`, [type, id]);
  await c.query(`delete from bee_sync where entity_type = $1 and entity_id = $2`, [type, id]);
  if (type === "idea") {
    await c.query(`delete from resort_backup where (table_name = 'idea_clusters' and row_id = $1)
      or (table_name = 'idea_mentions' and row_id in (select id from idea_mentions where cluster_id = $1))`, [id]);
    await c.query(`delete from idea_clusters where id = $1`, [id]); // mentions and garden events cascade
    return;
  }
  await c.query(`delete from resort_backup where table_name = 'recommendations' and row_id = $1`, [id]);
  await c.query(`delete from recommendations where id = $1`, [id]); // receipts and photos cascade
  const p = plan.recommender;
  if (p?.removed) {
    await c.query(`delete from ${RECOMMENDER_LINKS}`, [String(p.id)]);
    await c.query(`delete from recommenders where id = $1`, [p.id]);
  } else if (p) {
    // ponytail: inline recount until M3-T2's recomputeRecommender exists; recs_given = every rec, as the insert path counts.
    await c.query(`update recommenders p set
        recs_given = (select count(*) from recommendations r where r.recommender_id = p.id),
        recs_tried = (select count(*) from recommendations r where r.recommender_id = p.id and r.status in ('tried', 'thanked')),
        recs_loved = (select count(*) from recommendations r where r.recommender_id = p.id and r.rating = 'loved')
      where p.id = $1`, [p.id]);
  }
}

// Drops the mention, its backup row and its timeline line (paired by spoken_at, as timelineEntryJson writes it), then
// recomputes the idea as the save path keeps it: count and centroid over non-dismissed mentions (decision 004).
async function deleteMention(c: PoolClient, id: number): Promise<void> {
  await c.query(`delete from resort_backup where table_name = 'idea_mentions' and row_id = $1`, [id]);
  const [m] = await rows(c, `delete from idea_mentions where id = $1 returning cluster_id, spoken_at`, [id]);
  if (!m) return;
  const clusterId = Number(m.cluster_id);
  const spokenAt = new Date(m.spoken_at as string | Date).getTime();
  const [k] = await rows(c, `select timeline from idea_clusters where id = $1`, [clusterId]);
  const timeline = (k?.timeline ?? []) as { date: string }[];
  const at = timeline.findIndex((e) => Date.parse(e.date) === spokenAt);
  const kept = at === -1 ? timeline : [...timeline.slice(0, at), ...timeline.slice(at + 1)];
  await c.query(`
    update idea_clusters c set
      mention_count = s.n, stage = idea_stage_for(c.stage, s.n), centroid = s.centroid,
      first_mentioned_at = s.first, last_mentioned_at = s.last, timeline = $2::jsonb, updated_at = now()
    from (
      select count(*) filter (where review_status <> 'dismissed')::int as n, min(spoken_at) as first, max(spoken_at) as last,
             avg(embedding) filter (where review_status <> 'dismissed' and embedding is not null) as centroid
      from idea_mentions where cluster_id = $1
    ) s
    where c.id = $1`, [clusterId, JSON.stringify(kept)]);
}

export function planForget(target: ForgetTarget, refs: ForgetRefs & { exists: boolean }): ForgetStep[] {
  if (!refs.exists) return [];
  return [
    ...refs.beeTodoIds.map((beeId) => ({ kind: "bee_todo" as const, beeId })),
    ...refs.beeFactIds.map((beeId) => ({ kind: "bee_fact" as const, beeId })),
    ...refs.notionPageIds.map((pageId) => ({ kind: "notion_page" as const, pageId })),
    ...refs.blobUrls.map((url, i) => ({ kind: "blob" as const, url, n: i + 1 })),
    { kind: "db" as const, target },
  ];
}

// A thumbnail URL is printed as its position only: the path may carry a name.
const label = (s: ForgetStep) =>
  s.kind === "blob" ? `blob #${s.n ?? 1}` : s.kind === "notion_page" ? `notion_page ${s.pageId}`
    : s.kind === "db" ? `postgres ${s.target.type} ${s.target.id}` : `${s.kind} ${s.beeId}`;
const errName = (err: unknown) => (err instanceof Error ? err.name : "unknown");
const SKIPPED = { notion_page: "notion not configured (NOTION_TOKEN)", blob: "blob not configured (BLOB_READ_WRITE_TOKEN)" };

function runnerFor(s: ForgetStep, deps: ForgetDeps): (() => Promise<void>) | null {
  switch (s.kind) {
    case "bee_todo": return () => deps.deleteTodo(s.beeId);
    case "bee_fact": return () => deps.deleteFact(s.beeId);
    case "notion_page": { const trash = deps.trashNotionPage; return trash && (() => trash(s.pageId)); }
    case "blob": { const delBlob = deps.deleteBlob; return delBlob && (() => delBlob(s.url)); }
    case "db": return () => deps.deleteRows(s.target);
  }
}

// Outside steps first; a 404 is "already gone" (so a re-run is idempotent). Any other outside failure, or a step whose
// service is not configured, throws ForgetAbortedError before the db step runs. A db failure is thrown as is.
export async function executeForget(steps: readonly ForgetStep[], deps: ForgetDeps): Promise<string[]> {
  const log: string[] = [];
  for (const s of steps) {
    const run = runnerFor(s, deps);
    if (!run) {
      const line = `skipped: ${SKIPPED[s.kind as keyof typeof SKIPPED]} ${label(s)}`;
      throw new ForgetAbortedError([...log, line], new Error(line));
    }
    try {
      await run();
      log.push(`deleted ${label(s)}`);
    } catch (err) {
      if (s.kind === "db") throw err;
      if ((err as { status?: number })?.status === 404) {
        log.push(`already gone ${label(s)}`);
        continue;
      }
      throw new ForgetAbortedError([...log, `FAILED ${label(s)} error=${errName(err)}`], err);
    }
  }
  return log;
}

const covered = (now: ForgetRefs, done: ForgetRefs) =>
  (Object.keys(now) as (keyof ForgetRefs)[]).every((k) => (now[k] as unknown[]).every((v) => (done[k] as unknown[]).includes(v)));


// Notion's 2026-03-11 API (docs/research/integrations.md §2): `in_trash` replaced `archived`.
// ponytail: one call, no retry/rate limit; M3-T1's Notion client replaces it.
export async function trashNotionPage(pageId: string, opts: { token: string; fetchImpl?: typeof fetch }): Promise<void> {
  const res = await (opts.fetchImpl ?? fetch)(`https://api.notion.com/v1/pages/${encodeURIComponent(pageId)}`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${opts.token}`, "notion-version": "2026-03-11", "content-type": "application/json" },
    body: JSON.stringify({ in_trash: true }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw Object.assign(new Error(`Notion ${res.status}`), { name: "NotionApiError", status: res.status });
}

export function defaultExternalDeps(env: Record<string, string | undefined> = process.env): ExternalDeps {
  let bee: BeeClient | undefined;
  const client = () => (bee ??= createBeeClient());
  const notionToken = env.NOTION_TOKEN?.trim();
  return {
    deleteTodo: (id) => client().deleteTodo(id),
    deleteFact: (id) => client().deleteFact(id),
    trashNotionPage: notionToken ? (pageId) => trashNotionPage(pageId, { token: notionToken }) : null,
    deleteBlob: env.BLOB_READ_WRITE_TOKEN?.trim() ? (url) => del(url) : null,
  };
}

// ids and counts only. firstName and thumbnail URLs are never printed.
export function formatPlan(plan: ForgetPlan, done = false): string[] {
  const { target, resolved } = plan;
  if (!plan.exists) return [`nothing to forget for ${target.type} ${target.id}`];
  const nonzero = (r: Record<string, number>) => Object.entries(r).filter(([, n]) => n > 0).map(([t, n]) => `${t} ${n}`).join(", ");
  const verb = done ? "deleted" : "would delete";
  const { beeTodoIds, beeFactIds, notionPageIds, blobUrls } = plan.refs;
  return [
    ...(resolved.type !== target.type ? [`${target.type} ${target.id} is the last mention of idea ${resolved.id}: forgetting the idea`] : []),
    `${resolved.type} ${resolved.id}`,
    `  postgres ${verb} (one transaction): ${nonzero(plan.deletes)}`,
    ...(nonzero(plan.updates) ? [`  postgres ${done ? "recomputed" : "would recompute"}: ${nonzero(plan.updates)}`] : []),
    ...(beeTodoIds.length ? [`  outside: bee_todo ${beeTodoIds.join(", ")}`] : []),
    ...(beeFactIds.length ? [`  outside: bee_fact ${beeFactIds.join(", ")}`] : []),
    ...(notionPageIds.length ? [`  outside: notion_page ${notionPageIds.join(", ")}`] : []),
    ...(blobUrls.length ? [`  outside: blob ${blobUrls.length}`] : []),
  ];
}

async function runHooks(hooks: readonly ForgetHook[], ctx: ForgetHookContext): Promise<{ lines: string[]; incomplete: number }> {
  const lines: string[] = [];
  let incomplete = 0;
  for (const h of hooks) {
    try {
      lines.push(`hook ${h.name}: ${await h.run(ctx)}`);
    } catch (err) {
      lines.push(`FAILED hook ${h.name} error=${errName(err)}`);
      incomplete += 1;
    }
  }
  return { lines, incomplete };
}


// Dry run (yes false) reads inside a READ ONLY transaction and touches nothing. With yes: read refs → outside deletes →
// one locked transaction that re-reads the plan (refused if an outside ref appeared meanwhile) and deletes → hooks.
export async function forget(
  c: PoolClient, target: ForgetTarget, opts: { yes: boolean; deps?: ExternalDeps; hooks?: readonly ForgetHook[] },
): Promise<ForgetResult> {
  const plan = await inTransaction(c, true, async () => ({ value: await readPlan(c, target, false), commit: false }));
  if (!opts.yes || !plan.exists) return { plan, lines: [], incomplete: 0, aborted: false };
  let committed = plan;
  const deleteInTransaction = async () => {
    committed = await inTransaction(c, false, async () => {
      const p = await readPlan(c, target, true);
      if (!p.exists) return { value: p, commit: false };
      if (!covered(p.refs, plan.refs)) throw new ForgetRefsChangedError("an outside copy appeared since the outside deletes; re-run");
      await deleteRows(c, p);
      return { value: p, commit: true };
    });
  };
  let lines: string[];
  try {
    lines = await executeForget(planForget(target, { exists: true, ...plan.refs }), { ...(opts.deps ?? defaultExternalDeps()), deleteRows: deleteInTransaction });
  } catch (err) {
    if (err instanceof ForgetAbortedError) return { plan, lines: err.lines, incomplete: 1, aborted: true };
    throw err;
  }
  const hooks = await runHooks(opts.hooks ?? [], {
    target: committed.resolved, recommenderFirstName: committed.recommender?.firstName ?? null,
    recommenderRemoved: committed.recommender?.removed ?? false,
  });
  return { plan: committed, lines: [...lines, ...hooks.lines], incomplete: hooks.incomplete, aborted: false };
}
