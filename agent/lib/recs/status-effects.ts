import { beeTodoEffect } from "../sync/bee-todos";
import { closeShowTodoQuietly } from "./show-todos";
import { closeWhichOneTodoQuietly } from "./which-one-todo";
import type { RecStatus } from "../types";

// Side effects of a tip's status change, owned by other tasks. setRecStatus (status.ts) runs them in this order after
// every real change, each on its own: a throw is logged (ids + error name) and never stops the next one or undoes the
// change. An effect sees only ids and statuses; load anything else itself (getRec in store/rec-rows.ts).
// Changes that came from a surface must not be echoed back to it: check `origin`.

export type StatusOrigin = "garden" | "notion" | "bee" | "slack" | "system";

export interface StatusChange {
  recId: number;
  previous: RecStatus;
  next: RecStatus;
  origin: StatusOrigin;
  recommenderId: number | null;
}

export interface StatusEffect {
  name: string;
  run: (change: StatusChange) => Promise<void>;
}

export const STATUS_EFFECTS: readonly StatusEffect[] = [
  // M3-T7: entering or leaving "queued" nudges the Bee todo reconciler (sync/bee-todos.ts) now instead of at the next
  // bee-changes tick. It needs no origin check: it writes Bee only where Bee differs from Postgres.
  { name: "bee-todos", run: (c) => beeTodoEffect(c) },
  // Decision 062: a dismissed or composted tip no longer asks "Which one?", so its Bee todo is done. Loaded when used (cycle).
  { name: "which-one-todo", run: async (c) => {
    if (c.next === "dismissed" || c.next === "composted") await closeWhichOneTodoQuietly(c.recId);
  } },
  // Decision 064: a cleared tip's "plays nearby" todo is done too.
  { name: "show-todo", run: async (c) => {
    if (c.next === "dismissed" || c.next === "composted") await closeShowTodoQuietly(c.recId);
  } },
  // notion: M3-T2b when NOTION_TOKEN exists, e.g.
  //   { name: "notion", run: async (c) => { if (c.origin !== "notion") await pushRecToNotion(c.recId); } }
];
