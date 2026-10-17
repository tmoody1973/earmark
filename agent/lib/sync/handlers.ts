// Bee todo/fact changes arrive here from /v1/changes (and the live stream's todo events). M5 replaces the fact body;
// keep the signatures. Handlers must be idempotent: a change that throws is retried by id on later runs (bee-changes.ts).
import { BeeApiError, createBeeClient, type BeeClient, type Todo } from "../bee/client";
import { db } from "../db";
import { withLease } from "./bee-todos";
import { isEcho, TODO_CHANGE_HANDLERS, type TodoChangeHandler } from "./todo-handlers";

export interface TodoChangeDeps {
  bee?: Pick<BeeClient, "getTodo">;
  handlers?: readonly TodoChangeHandler[];
  lease?: string; // integration tests: their own lease name
}

const syncRow = async (beeId: number) => (await db()`
  select entity_type, entity_id, last_written_state from bee_sync where bee_object = 'todo' and bee_id = ${beeId}`)[0];

/**
 * FR-18: a todo changed in Bee. Not an Earmark todo, or no handler for its entity type: no-op (and no Bee read).
 * Otherwise, under the Bee todo lease (so it never interleaves with the reconciler's write-then-save): re-read the
 * row, GET the todo (404 → null), skip an exact echo of Earmark's own last write, dispatch. Lease busy or a Bee error
 * other than 404 throws: the change feed puts the id on its retry list, up to 5 runs (the stream path just logs).
 */
export async function handleTodoChange(beeId: number, deps: TodoChangeDeps = {}): Promise<void> {
  const handlers = deps.handlers ?? TODO_CHANGE_HANDLERS;
  const first = await syncRow(beeId);
  if (!first || !handlers.some((h) => h.entityType === first.entity_type)) return;
  const bee = deps.bee ?? createBeeClient();
  const out = await withLease(async () => {
    const row = await syncRow(beeId);
    const handler = row && handlers.find((h) => h.entityType === row.entity_type);
    if (!handler) return;
    let todo: Todo | null;
    try {
      todo = await bee.getTodo(beeId);
    } catch (err) {
      if (!(err instanceof BeeApiError && err.status === 404)) throw err;
      todo = null;
    }
    if (isEcho(row.last_written_state, todo)) return;
    await handler.run(Number(row.entity_id), todo);
  }, deps.lease);
  if (out === "locked") {
    const err = new Error(`Bee todo lease busy; todo ${beeId} replays`);
    err.name = "BeeTodoLeaseBusy";
    throw err;
  }
}

export async function handleFactChange(id: number): Promise<void> {
  void id;
}
