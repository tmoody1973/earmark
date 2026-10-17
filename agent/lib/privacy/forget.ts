// FR-30 (M3-T11): forget one rec, idea or mention everywhere. Adapted from PostHog draft PR #8; decision 011.
// Order: the outside copies first (Bee todos/facts, Notion page, Blob thumbnails; a 404 means already gone), then ONE
// locked Postgres transaction that deletes the rows (forget-rows.ts) and runs other lanes' hooks with its client.
// Any other outside failure (or an unconfigured service that has refs) aborts BEFORE Postgres; a failing hook rolls the
// transaction back. Either way the refs are still there and re-running the command retries safely.
// Logs and plans carry ids and counts only, never text.
import { del } from "@vercel/blob";
import type { PoolClient } from "@neondatabase/serverless";
import { createBeeClient, type BeeClient } from "../bee/client";
import { inTransaction } from "../db";
import { deleteRows, readPlan, type ForgetPlan, type ForgetRefs, type ForgetTarget } from "./forget-rows";

export { readPlan, deleteRows, ForgetTimelineError, type ForgetPlan, type ForgetRefs, type ForgetTarget } from "./forget-rows";

export type ForgetStep =
  | { kind: "bee_todo" | "bee_fact"; beeId: number }
  | { kind: "notion_page"; pageId: string }
  | { kind: "blob"; url: string; n?: number }
  | { kind: "db"; target: ForgetTarget };
// null = that service is not configured: a step that needs it is skipped, said so, and aborts before Postgres.
export interface ExternalDeps {
  deleteTodo(id: number): Promise<void>;
  deleteFact(id: number): Promise<void>;
  trashNotionPage: ((pageId: string) => Promise<void>) | null;
  deleteBlob: ((url: string) => Promise<void>) | null;
}
export interface ForgetDeps extends ExternalDeps { deleteRows(target: ForgetTarget): Promise<void> }
// Other lanes' forgetters (lane C: M5 episodes, gardener runs), listed in forget-hooks.ts. They run inside the forget
// transaction: use `c` for every query so a failure rolls everything back. `run` returns one line of ids/counts.
export interface ForgetHookContext {
  c: PoolClient; target: ForgetTarget; recommenderFirstName: string | null; recommenderRemoved: boolean;
  savedAt: Date | null; // when the forgotten item first entered Earmark (read before its rows were deleted)
}
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
// The locked re-read differs from the outside pass (a new outside ref, or the mention became its idea's last): rolled back.
export class ForgetRefsChangedError extends Error {
  override name = "ForgetRefsChangedError";
}
// A one-pager draft is being written for the idea (its claim is inside the lease): forget refuses rather than race it.
// Nothing outside or in Postgres was touched. (A drafter whose claim outlived the lease cannot save after a forget
// either: saveDraft checks the claim it holds is still current.)
export class ForgetDraftInFlightError extends Error {
  override name = "ForgetDraftInFlightError";
  constructor(ideaId: number) {
    super(`idea ${ideaId}: a draft is being written, retry in a few minutes`);
  }
}
// The idea was merged into another and the merge can still be undone (M4-T6, decision 027): forgetting it alone would
// leave the merge half there. Undo the merge, or forget the idea it went into (which ends the merge). Nothing touched.
export class ForgetMergedError extends Error {
  override name = "ForgetMergedError";
  constructor(ideaId: number, keepId: number) {
    super(`idea ${ideaId} was merged into ${keepId}: undo the merge or forget ${keepId}`);
  }
}
// A hook threw: the transaction rolled back. The message names the hook and the cause's err.name only.
export class ForgetHookError extends Error {
  override name = "ForgetHookError";
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
// Already trashed = done. The trash-page reference (https://developers.notion.com/reference/trash-page, read via ctx7
// 2026-10-16) documents only a 200 with the page's `in_trash` state; it does not say what re-trashing a trashed page
// returns. So both count as done: that 200, and a 400 `validation_error` whose message says the page is archived/in
// trash (Notion's wording for editing an archived block; not in that reference), so a re-run can never get stuck.
// ponytail: one call, no retry/rate limit; M3-T1's Notion client replaces it.
export async function trashNotionPage(pageId: string, opts: { token: string; fetchImpl?: typeof fetch }): Promise<void> {
  const res = await (opts.fetchImpl ?? fetch)(`https://api.notion.com/v1/pages/${encodeURIComponent(pageId)}`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${opts.token}`, "notion-version": "2026-03-11", "content-type": "application/json" },
    body: JSON.stringify({ in_trash: true }),
    signal: AbortSignal.timeout(15_000),
  });
  if (res.ok) return;
  if (res.status === 400) {
    const body = (await res.json().catch(() => null)) as { code?: string; message?: string } | null;
    if (body?.code === "validation_error" && /\b(?:is|was) (?:archived|in (?:the )?trash)\b/i.test(body.message ?? "")) return;
  }
  throw Object.assign(new Error(`Notion ${res.status}`), { name: "NotionApiError", status: res.status });
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
    ...plan.notes.map((n) => `  note: ${n}`),
  ];
}

const sameTarget = (a: ForgetTarget, b: ForgetTarget) => a.type === b.type && a.id === b.id;

async function runHooks(hooks: readonly ForgetHook[], ctx: ForgetHookContext): Promise<string[]> {
  const lines: string[] = [];
  for (const h of hooks) {
    try {
      lines.push(`hook ${h.name}: ${await h.run(ctx)}`);
    } catch (err) {
      throw new ForgetHookError(`hook ${h.name} failed error=${errName(err)}`, { cause: err });
    }
  }
  return lines;
}

// Dry run (yes false) reads inside a READ ONLY transaction and touches nothing. With yes: read refs → outside deletes →
// one locked transaction: re-read the plan (refused if it changed), delete the rows, run the hooks with its client.
export async function forget(
  c: PoolClient, target: ForgetTarget, opts: { yes: boolean; deps?: ExternalDeps; hooks?: readonly ForgetHook[] },
): Promise<ForgetResult> {
  const plan = await inTransaction(c, true, async () => ({ value: await readPlan(c, target, false), commit: false }));
  if (!opts.yes || !plan.exists) return { plan, lines: [], incomplete: 0, aborted: false };
  if (plan.draftInFlight !== undefined) throw new ForgetDraftInFlightError(plan.draftInFlight);
  if (plan.mergedInto !== undefined) throw new ForgetMergedError(plan.resolved.id, plan.mergedInto);
  let committed = plan;
  let txLines: string[] = [];
  const deleteInTransaction = async () => {
    [committed, txLines] = await inTransaction(c, false, async () => {
      const p = await readPlan(c, target, true);
      if (!p.exists) return { value: [p, []] as [ForgetPlan, string[]], commit: false };
      if (p.draftInFlight !== undefined) throw new ForgetDraftInFlightError(p.draftInFlight);
      if (p.mergedInto !== undefined) throw new ForgetMergedError(p.resolved.id, p.mergedInto);
      if (!sameTarget(p.resolved, plan.resolved) || !covered(p.refs, plan.refs)) {
        throw new ForgetRefsChangedError("the item changed since the outside deletes (new outside copy, or the mention became its idea's last); re-run");
      }
      const rowLines = await deleteRows(c, p);
      const hookLines = await runHooks(opts.hooks ?? [], {
        c, target: p.resolved, recommenderFirstName: p.recommender?.firstName ?? null, recommenderRemoved: p.recommender?.removed ?? false,
        savedAt: p.savedAt,
      });
      return { value: [p, [...rowLines, ...hookLines]] as [ForgetPlan, string[]], commit: true };
    });
  };
  let lines: string[];
  try {
    lines = await executeForget(planForget(target, { exists: true, ...plan.refs }), { ...(opts.deps ?? defaultExternalDeps()), deleteRows: deleteInTransaction });
  } catch (err) {
    if (err instanceof ForgetAbortedError) return { plan, lines: err.lines, incomplete: 1, aborted: true };
    throw err;
  }
  return { plan: committed, lines: [...lines, ...txLines], incomplete: 0, aborted: false };
}
