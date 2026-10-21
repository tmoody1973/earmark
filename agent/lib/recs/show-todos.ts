// Shows nearby (decision 064): the parts the status effects need, apart from shows.ts so that status.ts → status-effects
// never loads the web search (web-find → which-one → lane, an import cycle at load time). Closing only: what a tip's
// show todo names, when it is done, and completing it with decision 062's machinery. Logs: ids and err.name only.
import { BeeApiError, createBeeClient, type BeeClient } from "../bee/client";
import { db } from "../db";
import { norm } from "../enrich/apple-music";
import type { Show } from "../enrich/extras";
import { logEnrichError } from "../enrich/types";
import { TIMELINE_TZ } from "../ideas/timeline-format";
import { withLease } from "../sync/bee-todos";
import type { RecType } from "../types";
import { HIDDEN_TIP_STATUSES } from "./status";

// lane.ts's SWEEP_SKIPS_STATUSES, read when called (importing lane breaks eve's one-module bundle; which-one-todo.ts).
export const sweepSkips = () => HIDDEN_TIP_STATUSES.filter((s) => s !== "needs_review");

export const SHOW_ENTITY = "show";

export interface ShowTip { type: RecType; canonical_name: string; creator: string | null }
/** extras.shows as stored: { checkedAt, items, told, todoDate } (todoDate: the day of the show the todo names). */
export interface Stored { checkedAt?: unknown; items?: unknown; told?: unknown; todoDate?: unknown }

export const artistOf = (tip: ShowTip) => (tip.type === "artist" ? tip.canonical_name : tip.creator)?.trim() || null;
/** Milwaukee's date today, YYYY-MM-DD. */
export const todayIn = (now: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TIMELINE_TZ }).format(now);
/** Who plays, where and when: the same show from any tip, any day. Pure. */
export const showKey = (artist: string, s: Pick<Show, "date" | "venue">) => `${norm(artist)}|${s.date}|${norm(s.venue)}`;
export const storedItems = (s: Stored | null): Show[] => (Array.isArray(s?.items) ? (s.items as Show[]) : []);
export const storedTold = (s: Stored | null): string[] => (Array.isArray(s?.told) ? s.told.filter((t): t is string => typeof t === "string") : []);

/** A show todo is done once the show it names has passed (home time) and no newer show is waiting to be told. Pure. */
export function showTodoDone(state: Stored | null, artist: string, today: string): boolean {
  const todoDate = typeof state?.todoDate === "string" ? state.todoDate : null;
  if (!todoDate || todoDate >= today) return false;
  const told = storedTold(state);
  return !storedItems(state).some((s) => s.date >= today && !told.includes(showKey(artist, s)));
}

export interface CloseDeps {
  bee?: Pick<BeeClient, "listTodos" | "createTodo" | "updateTodo" | "deleteTodo" | "getTodo">;
  env?: Record<string, string | undefined>;
  onlyIds?: readonly number[] | null; // tests: never touch other rows
  now?: Date;
}

/**
 * Complete every open show todo whose tip is gone or cleared (dismissed, composted, overheard), or whose show has passed
 * with nothing newer to tell: a past show never holds one of the 10 open slots. Decision 062's machinery: the Bee
 * lease, 404 = already gone, the bee_sync row kept with completed: true (a later show makes a new todo). Idempotent.
 */
export async function closeShowTodos(deps: CloseDeps = {}): Promise<number> {
  const env = deps.env ?? process.env;
  if (env.BEE_TODO_WRITES !== "on") return 0;
  const only = deps.onlyIds ?? null;
  const rows = (await db()`
    select s.entity_id as id, s.bee_id, s.last_written_state, r.id as rec_id, r.status, r.type, r.canonical_name, r.creator, r.extras->'shows' as shows
    from bee_sync s left join recommendations r on r.id = s.entity_id
    where s.entity_type = ${SHOW_ENTITY} and s.bee_object = 'todo'
      and coalesce(s.last_written_state->>'completed', 'false') <> 'true'
      and (${only}::bigint[] is null or s.entity_id = any(${only}::bigint[]))`) as
    (Partial<ShowTip> & { id: number | string; bee_id: number | string; last_written_state: { text?: unknown } | null; rec_id: unknown;
      status: string | null; shows: Stored | null })[];
  const today = todayIn(deps.now ?? new Date());
  const done = rows.filter((r) => r.rec_id === null || (sweepSkips() as readonly string[]).includes(r.status ?? "")
    || showTodoDone(r.shows, artistOf(r as ShowTip) ?? "", today));
  if (done.length === 0) return 0;
  const bee = deps.bee ?? createBeeClient();
  const closed = await withLease(async () => {
    let n = 0;
    for (const row of done) {
      try {
        await bee.updateTodo(Number(row.bee_id), { completed: true });
      } catch (err) {
        if (!(err instanceof BeeApiError && err.status === 404)) { logEnrichError("shows todo close", { rec: Number(row.id) }, err); continue; }
      }
      await db()`update bee_sync set last_written_state = ${JSON.stringify({ text: row.last_written_state?.text ?? "", completed: true })}::jsonb, last_synced_at = now()
        where entity_type = ${SHOW_ENTITY} and entity_id = ${Number(row.id)} and bee_object = 'todo'`;
      n++;
    }
    return n;
  });
  return closed === "locked" ? 0 : closed; // locked: the lane's next pass completes it
}

/** After a tip is cleared: never lets a Bee problem touch the status change itself. */
export async function closeShowTodoQuietly(recId: number): Promise<void> {
  try {
    await closeShowTodos({ onlyIds: [recId] });
  } catch (err) {
    logEnrichError("shows todo close", { rec: recId }, err);
  }
}
