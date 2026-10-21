// "Is this the one?" on the wrist (decision 062): when the lane leaves a tip asking "Which one?" (automatic, final
// no_match, options kept, owner not answered), the agent makes ONE Bee todo for it through createEarmarkTodo: its cap,
// kill switch (BEE_TODO_WRITES) and lease, bee_sync under entity type 'which_one' keyed by the tip's id. The text is the
// first option's name only (a public catalog or page title): never an excerpt, never a person's name (todo-text.ts).
// One todo per tip, ever: a bee_sync row means it was made, even once it is done; changed options refresh it in place.
// Not for the owner's own Search again (candidates_at later than enriched_at: he is already on the page).
// The question answered (a pick, None of these, a fix, dismissed/composted) completes the todo: closeWhichOneTodos is
// called right then, and again by the lane every pass as the backstop. Cap / writes off / locked: skipped, the tip is
// untouched. Logs: ids and err.name only.
import { BeeApiError, createBeeClient, type BeeClient } from "../bee/client";
import { db } from "../db";
import { logEnrichError } from "../enrich/types";
import { readCandidates } from "../garden/which-one";
import { createEarmarkTodo, withLease } from "../sync/bee-todos";
import { TODO_PREFIX, withLink } from "../sync/todo-text";
import { HIDDEN_TIP_STATUSES } from "./status";

// lane.ts's SWEEP_SKIPS_STATUSES (cleared and overheard tips; maybes stay), read when called: importing lane, or a
// dynamic import, breaks eve's one-module-per-schedule bundle (CI, Oct 21).
const sweepSkips = () => HIDDEN_TIP_STATUSES.filter((s) => s !== "needs_review");

export const WHICH_ONE_ENTITY = "which_one";
export const MAX_WRIST_ASKS_PER_PASS = 3;

export interface WristDeps {
  bee?: Pick<BeeClient, "listTodos" | "createTodo" | "updateTodo" | "deleteTodo" | "getTodo">;
  env?: Record<string, string | undefined>;
  onlyIds?: readonly number[] | null; // tests: never touch other rows
  base?: string; // EARMARK_PUBLIC_BASE_URL
}
export interface WristCounts { created: number; refreshed: number; completed: number }

/** The todo's words before its link and prefix: the first option's name, clipped. Pure. */
export function whichOneTodoText(optionName: string): string {
  const name = optionName.length > 80 ? `${optionName.slice(0, 79)}…` : optionName;
  return `Is this ${name}? Confirm in Earmark`;
}

const full = (name: string, id: number, base?: string) => `${TODO_PREFIX}${withLink(whichOneTodoText(name), "tips", id, base)}`;
const writesOn = (env: Record<string, string | undefined>) => env.BEE_TODO_WRITES === "on";
type Written = { text?: unknown; completed?: unknown } | null;

/** Make (or refresh) the one todo for each tip that asks "Which one?" and has none yet. */
export async function openWhichOneTodos(deps: WristDeps = {}): Promise<Pick<WristCounts, "created" | "refreshed">> {
  const env = deps.env ?? process.env;
  const out = { created: 0, refreshed: 0 };
  if (!writesOn(env)) return out;
  const only = deps.onlyIds ?? null;
  const rows = (await db()`
    select r.id, r.match_candidates, s.last_written_state, coalesce(r.candidates_at > r.enriched_at, false) as owner_searched
    from recommendations r
    left join bee_sync s on s.entity_type = ${WHICH_ONE_ENTITY} and s.entity_id = r.id and s.bee_object = 'todo'
    where r.enrichment_status = 'no_match' and r.match_source = 'auto' and r.owner_none_at is null
      and jsonb_typeof(r.match_candidates) = 'array' and r.match_candidates <> '[]'::jsonb
      and r.status <> all(${sweepSkips()}::text[])
      and coalesce(s.last_written_state->>'completed', 'false') <> 'true'
      and (${only}::bigint[] is null or r.id = any(${only}::bigint[]))
    order by r.id desc limit 20`) as { id: number | string; match_candidates: unknown; last_written_state: Written | null; owner_searched: boolean }[];
  for (const row of rows) {
    if (row.owner_searched) continue; // his own search: he is already on the page
    const first = readCandidates(row.match_candidates)[0];
    if (!first) continue;
    const id = Number(row.id);
    const text = full(first.canonicalName, id, deps.base ?? env.EARMARK_PUBLIC_BASE_URL?.trim());
    const had = row.last_written_state !== null;
    if (had && row.last_written_state?.text === text) continue;
    if (!had && out.created >= MAX_WRIST_ASKS_PER_PASS) continue;
    try {
      const res = await createEarmarkTodo({ entityType: WHICH_ONE_ENTITY, entityId: id, text, alarmAt: null, refresh: had }, { bee: deps.bee, env });
      if ("skipped" in res) console.log(`[which-one-todo] rec=${id} skipped=${res.skipped}`);
      else if (had) out.refreshed++;
      else out.created++;
    } catch (err) {
      logEnrichError("which-one todo", { rec: id }, err); // a Bee error never stops the lane or the next tip
    }
  }
  return out;
}

/** Complete the todo of every tip that no longer asks (answered, fixed, dismissed, composted, gone). Idempotent. */
export async function closeWhichOneTodos(deps: WristDeps = {}): Promise<number> {
  const env = deps.env ?? process.env;
  if (!writesOn(env)) return 0;
  const only = deps.onlyIds ?? null;
  const rows = (await db()`
    select s.entity_id as id, s.bee_id, s.last_written_state from bee_sync s
    left join recommendations r on r.id = s.entity_id
    where s.entity_type = ${WHICH_ONE_ENTITY} and s.bee_object = 'todo'
      and coalesce(s.last_written_state->>'completed', 'false') <> 'true'
      and (${only}::bigint[] is null or s.entity_id = any(${only}::bigint[]))
      and not (r.id is not null and r.match_source = 'auto' and r.owner_none_at is null
        and r.enrichment_status in ('no_match', 'pending') and r.status <> all(${sweepSkips()}::text[])
        and jsonb_typeof(r.match_candidates) = 'array' and r.match_candidates <> '[]'::jsonb)`) as
    { id: number | string; bee_id: number | string; last_written_state: Written }[];
  if (rows.length === 0) return 0;
  const bee = deps.bee ?? createBeeClient();
  const done = await withLease(async () => {
    let n = 0;
    for (const row of rows) {
      try {
        await bee.updateTodo(Number(row.bee_id), { completed: true });
      } catch (err) {
        if (!(err instanceof BeeApiError && err.status === 404)) { logEnrichError("which-one todo close", { rec: Number(row.id) }, err); continue; }
      }
      // keep the row: it is the "one per tip, ever" record
      await db()`update bee_sync set last_written_state = ${JSON.stringify({ text: row.last_written_state?.text ?? "", completed: true })}::jsonb, last_synced_at = now()
        where entity_type = ${WHICH_ONE_ENTITY} and entity_id = ${Number(row.id)} and bee_object = 'todo'`;
      n++;
    }
    return n;
  });
  return done === "locked" ? 0 : done; // locked: the lane's next pass completes it
}

/** After an answer: never lets a Bee problem touch the answer itself. */
export async function closeWhichOneTodoQuietly(recId: number, deps: WristDeps = {}): Promise<void> {
  try {
    await closeWhichOneTodos({ ...deps, onlyIds: [recId] });
  } catch (err) {
    logEnrichError("which-one todo close", { rec: recId }, err);
  }
}
