import { randomUUID } from "node:crypto";
import { db } from "../db";
import { askBooleans, type BooleanQuestion } from "../decide/ask-booleans";
import { HIDDEN_TIP_STATUSES } from "../garden/queries";
import { toIdea } from "../links/candidates";
import { ideaText } from "../links/judge";
import { recEmbedText } from "../recs/embed-text";
import { spaceKey, spaceQuestion } from "./criteria";

export { SPACE_MIN, spaceKey, spaceQuestion } from "./criteria";

// The budget (decision 028). One Jev call asks about one item against up to MAX_SPACES_PER_CALL Spaces. A run makes
// at most MAX_CALLS_PER_RUN calls, and any one Space takes part in at most MAX_CALLS_PER_SPACE of them, so a new
// Space with a big backlog cannot starve the others. Pairs already judged are skipped until the item changes; what is
// left waits for the next hourly run. Cost: see decision 028 (one measured call on the TEST branch).
export const MAX_CALLS_PER_RUN = 40;
export const MAX_CALLS_PER_SPACE = 30;
export const MAX_SPACES_PER_CALL = 8;
const MAX_FAILURES_IN_A_ROW = 3; // the gateway is down: stop instead of walking the whole list

export interface EvaluateResult {
  calls: number; pairs: number; failed: number;
  /** pairs left for the next run because their Space had spent its share */
  skipped: number;
  /** another run held the lock: this one did nothing */
  busy: boolean;
}

interface PendingItem { type: "idea" | "rec"; id: number; text: string; spaces: Array<{ id: number; sentence: string }> }

type PendingRow = {
  item_type: "idea" | "rec"; item_id: number | string; name: string; detail: string | null; timeline: unknown;
  rec_type: string | null; creator: string | null; space_ids: Array<number | string>; sentences: string[];
};

// What Jev reads: a tip exactly as it is embedded (recEmbedText, the one recipe); an idea as the backlinks read it.
function itemText(r: PendingRow): string {
  if (r.item_type === "rec") return recEmbedText({ type: r.rec_type ?? "other", name: r.name, creator: r.creator, contextSummary: r.detail });
  return `idea: ${ideaText(toIdea({ id: r.item_id, title: r.name, summary: r.detail, timeline: r.timeline }))}`;
}

/**
 * Visible items (a growing idea with a counted mention; a tip the shelf shows) with every Space still waiting on them:
 * never judged, or judged as a suggestion before the item last changed. Tarik's keep or remove is never re-asked.
 * Newest changes first, at most `limit` items (each needs at least one call).
 */
async function pendingItems(limit: number, spaceId: number | null): Promise<PendingItem[]> {
  const rows = (await db()`
    with v as (
      select 'idea'::text as item_type, c.id as item_id, c.updated_at, c.title as name, c.summary as detail, c.timeline,
        null::text as rec_type, null::text as creator
      from idea_clusters c where c.stage <> 'dismissed' and c.mention_count > 0
      union all
      select 'rec', r.id, r.updated_at, r.canonical_name, r.context_summary, null, r.type, r.creator
      from recommendations r where r.status <> all(${HIDDEN_TIP_STATUSES}::text[])
    )
    select v.item_type, v.item_id, v.name, v.detail, v.timeline, v.rec_type, v.creator,
      array_agg(s.id order by s.id) as space_ids, array_agg(s.rule_sentence order by s.id) as sentences
    from v cross join spaces s
    left join space_items si on si.space_id = s.id and si.item_type = v.item_type and si.item_id = v.item_id
    where (si.space_id is null or (si.status = 'suggested' and si.judged_at < v.updated_at))
      and (${spaceId}::bigint is null or s.id = ${spaceId})
    group by v.item_type, v.item_id, v.name, v.detail, v.timeline, v.rec_type, v.creator, v.updated_at
    order by v.updated_at desc, v.item_type, v.item_id
    limit ${limit}`) as PendingRow[];
  return rows.map((r) => ({
    type: r.item_type,
    id: Number(r.item_id),
    text: itemText(r),
    spaces: r.space_ids.map((id, i) => ({ id: Number(id), sentence: r.sentences[i] })),
  }));
}

// One statement per call. A re-judge refreshes Jev's probability and judged_at but never touches an item Tarik kept or
// removed. A Space deleted, or an item forgotten, while Jev was thinking gets no row.
async function writeJudgements(item: PendingItem, spaceIds: number[], probs: number[]): Promise<void> {
  const table = item.type === "idea" ? "idea" : "rec";
  await db()`
    insert into space_items (space_id, item_type, item_id, confidence, judged_at)
    select t.space_id, ${table}, ${item.id}, t.p, now()
    from unnest(${spaceIds}::bigint[], ${probs}::real[]) as t(space_id, p)
    join spaces s on s.id = t.space_id
    where (${table} = 'idea' and exists (select 1 from idea_clusters where id = ${item.id}))
       or (${table} = 'rec' and exists (select 1 from recommendations where id = ${item.id}))
    on conflict (space_id, item_type, item_id) do update
      set confidence = excluded.confidence, judged_at = excluded.judged_at
      where space_items.status = 'suggested'`;
}

// Runs never overlap (the hourly run and a new Space's first fill would judge the same pairs twice): a claimed row in
// sync_cursors, taken only when free or stale. The lease outlives the longest run (40 calls × 20 s ≈ 13 min).
const LOCK = "spaces_evaluate_lock";
async function claimRun(token: string): Promise<boolean> {
  const rows = await db()`
    insert into sync_cursors (name, cursor) values (${LOCK}, ${token})
    on conflict (name) do update set cursor = excluded.cursor, updated_at = now()
      where sync_cursors.updated_at < now() - interval '15 minutes'
    returning name`;
  return rows.length > 0;
}
async function releaseRun(token: string): Promise<void> {
  await db()`delete from sync_cursors where name = ${LOCK} and cursor = ${token}`;
}

const errName = (err: unknown) => (err instanceof Error ? err.name : "unknown");

/**
 * One bounded pass over the items still waiting on a Space. `spaceId`: only that Space (its first fill, right after
 * it is created). Logs ids, counts and error names only, never item text or a Space's sentence.
 */
export async function evaluateSpaces(
  opts: { spaceId?: number; maxCalls?: number; ask?: typeof askBooleans } = {},
): Promise<EvaluateResult> {
  const token = randomUUID();
  if (!(await claimRun(token))) {
    console.log("[spaces] run skipped: another run holds the lock");
    return { calls: 0, pairs: 0, failed: 0, skipped: 0, busy: true };
  }
  try {
    return await run(opts.maxCalls ?? MAX_CALLS_PER_RUN, opts.spaceId ?? null, opts.ask ?? askBooleans);
  } finally {
    await releaseRun(token);
  }
}

async function run(maxCalls: number, spaceId: number | null, ask: typeof askBooleans): Promise<EvaluateResult> {
  const out: EvaluateResult = { calls: 0, pairs: 0, failed: 0, skipped: 0, busy: false };
  const perSpace = new Map<number, number>();
  let failuresInARow = 0;
  const halted = () => out.calls >= maxCalls || failuresInARow >= MAX_FAILURES_IN_A_ROW;

  for (const item of await pendingItems(maxCalls, spaceId)) {
    const open = item.spaces.filter((s) => (perSpace.get(s.id) ?? 0) < MAX_CALLS_PER_SPACE);
    out.skipped += item.spaces.length - open.length;
    for (let i = 0; i < open.length; i += MAX_SPACES_PER_CALL) {
      if (halted()) break;
      const chunk = open.slice(i, i + MAX_SPACES_PER_CALL);
      out.calls++;
      for (const s of chunk) perSpace.set(s.id, (perSpace.get(s.id) ?? 0) + 1);
      const questions = Object.fromEntries(chunk.map((s) => [spaceKey(s.id), spaceQuestion(s.sentence)])) as Record<string, BooleanQuestion>;
      try {
        const probs = await ask({ item: item.text }, questions);
        await writeJudgements(item, chunk.map((s) => s.id), chunk.map((s) => probs[spaceKey(s.id)]));
        out.pairs += chunk.length;
        failuresInARow = 0;
      } catch (err) {
        out.failed++;
        failuresInARow++;
        console.error(`[spaces] judge failed ${item.type}=${item.id} spaces=${chunk.map((s) => s.id).join(",")} error=${errName(err)}`);
      }
    }
    if (halted()) break;
  }

  console.log(`[spaces] run calls=${out.calls} pairs=${out.pairs} failed=${out.failed} skipped=${out.skipped} cap=${maxCalls}`);
  return out;
}
