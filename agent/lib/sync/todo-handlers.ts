// Inbound Bee todo changes (FR-18), one handler per bee_sync.entity_type. handleTodoChange (handlers.ts) finds the
// bee_sync row by Bee id, reads the todo (null on a 404), drops exact echoes of what Earmark last wrote, and calls the
// entry for that entity type; unknown types are a no-op. A handler runs UNDER the Bee todo lease (bee-todos.ts), so
// it never races the reconciler: don't call drainTodoQueue/createEarmarkTodo from it (they would see "locked").
// Inbound changes write Postgres even with BEE_TODO_WRITES off; nothing here writes to Bee. Decision 016.
import type { Todo } from "../bee/client";
import { db } from "../db";
import { setRecStatus } from "../recs/status";
import { saveLeft, saveTodo } from "./bee-todos";

export interface TodoChangeHandler {
  entityType: string;
  run: (entityId: number, todo: Todo | null) => Promise<void>;
}

type WrittenState = { text?: unknown; completed?: unknown } | null;

/** The change is exactly what Earmark last wrote to Bee: its own write coming back. Pure. */
export function isEcho(last: WrittenState, todo: Todo | null): boolean {
  return !!last && !!todo && todo.completed === last.completed && todo.text === last.text;
}

export type RecTodoAction = "ignore" | "mark_tried" | "requeue" | "unlink";

/**
 * What a change to a tip's todo means. Pure. Only `completed` counts against what Earmark last wrote: a text edit in
 * Bee is Tarik's wording, kept in Bee and never acted on. A 404 means he deleted it (decision 016).
 */
export function recTodoAction(last: WrittenState, todo: Todo | null): RecTodoAction {
  if (!todo) return "unlink";
  if (todo.completed === (last?.completed === true)) return "ignore";
  return todo.completed ? "mark_tried" : "requeue";
}

// Every write is guarded on the current state: setRecStatus compare-and-sets the status (and Bee may never revive a
// dismissed or composted tip); saveLeft/saveTodo only touch the link while it still points where we expect.
async function handleRecTodoChange(recId: number, todo: Todo | null): Promise<void> {
  const [s] = await db()`
    select bee_id, last_written_state from bee_sync where entity_type = 'rec' and entity_id = ${recId} and bee_object = 'todo'`;
  if (!s) return;
  const beeId = Number(s.bee_id);
  const last = s.last_written_state as WrittenState;
  const [rec] = await db()`select status, bee_todo_id from recommendations where id = ${recId}`;
  switch (recTodoAction(last, todo)) {
    case "ignore":
      return;
    case "mark_tried": {
      // Checked off in Bee: tried. Then record what the reconciler would (link cleared, completion kept), so it has
      // nothing to write back and a later uncheck still reads as a change.
      const { changed } = await setRecStatus(recId, "tried", "bee", { from: ["queued"] });
      if (changed || (rec && rec.status !== "queued")) await saveLeft(recId, beeId, true);
      return;
    }
    case "requeue": {
      // Unchecked in Bee: back in the queue, re-linked to this same todo with the stored text, so the reconciler sees a
      // linked queued tip and never rewrites Tarik's wording.
      await setRecStatus(recId, "queued", "bee", { from: ["tried"] });
      const storedText = typeof last?.text === "string" ? last.text : todo!.text;
      await saveTodo("rec", recId, beeId, storedText, true);
      return;
    }
    case "unlink":
      // Deleted in Bee: he dismissed the todo, not the tip. Only the tip's live todo sends it back to 'new'; deleting an
      // already-completed one is housekeeping. Status first: a crash before the unlink is finished by the next replay
      // or the reconciler (its delete 404s), never by a fresh todo for a tip still marked queued.
      if (rec?.status === "queued" && Number(rec.bee_todo_id) === beeId) {
        await setRecStatus(recId, "new", "bee", { from: ["queued"] });
      }
      await saveLeft(recId, beeId, false);
      return;
  }
}

export const TODO_CHANGE_HANDLERS: readonly TodoChangeHandler[] = [
  { entityType: "rec", run: handleRecTodoChange },
  // Lane C registers { entityType: "rec_receipt", run: handleReceiptTodoChange } from agent/lib/recs/receipts.ts here
  // (and removes its TEMP dispatch block from handleTodoChange). Place nudges have no handler: their changes are a no-op.
];
