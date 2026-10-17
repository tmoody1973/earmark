import { del } from "@vercel/blob";
import type { PoolClient } from "@neondatabase/serverless";
import type { ForgetHook } from "./forget";
import { createBeeClient } from "../bee/client";
import { forgetPersonInEpisodes, forgetPersonInGardenerRuns, forgetPlaceNudges, forgetRecReceipts, type Sql } from "./forget-m5";

// Forgetters owned by other lanes, run by `pnpm forget --yes` INSIDE the locked Postgres transaction, after the item's
// rows are deleted and after the Bee/Notion/Blob deletes. Use `ctx.c` (a pg PoolClient: `ctx.c.query(text, values)`) for
// every query so a throw rolls the whole forget back and a re-run retries. Return one line of ids/counts, never text.
// bee_sync contract: forget-rows.ts deletes bee_sync rows (and their Bee todos/facts) of entity_type 'rec' and 'idea'
// only (plus 'fact_proposal'). Every other entity type, e.g. M5's 'place_nudge' and 'rec_receipt' todos made with
// createEarmarkTodo (sync/bee-todos.ts), is deleted, Bee todo included, by its owner's hook below (lane C).

// Lane C's functions take a tagged-template `sql`; this one runs it on the forget transaction's client.
const sqlOver = (c: PoolClient): Sql => async (strings, ...values) =>
  (await c.query(strings.reduce((text, s, i) => `${text}$${i}${s}`), values)).rows as Record<string, unknown>[];
const ids = (xs: number[]) => (xs.length ? ` (ids ${xs.join(", ")})` : "");

// Lane C (M5). Episodes and drafts go by the item's first-save time (any target) and, for a rec, its recommender's name.
// Order matters: episodes is last because its Blob audio deletes cannot roll back if a later hook threw.
export const FORGET_HOOKS: readonly ForgetHook[] = [
  {
    name: "gardener_runs",
    run: async (ctx) => {
      const { runIds } = await forgetPersonInGardenerRuns(ctx.recommenderFirstName, { sql: sqlOver(ctx.c) }, ctx.savedAt);
      return `gardener_runs ${runIds.length}${ids(runIds)}`;
    },
  },
  {
    name: "place_nudges",
    run: async (ctx) => {
      if (ctx.target.type !== "rec") return "place_nudges 0";
      const { beeTodoIds } = await forgetPlaceNudges({ sql: sqlOver(ctx.c), deleteTodo: (id) => createBeeClient().deleteTodo(id) });
      return `place_nudges ${beeTodoIds.length}${beeTodoIds.length ? ` (bee todos ${beeTodoIds.join(", ")})` : ""}`;
    },
  },
  {
    name: "rec_receipts",
    run: async (ctx) => {
      if (ctx.target.type !== "rec") return "rec_receipts 0";
      const { beeTodoIds } = await forgetRecReceipts({ sql: sqlOver(ctx.c), deleteTodo: (id) => createBeeClient().deleteTodo(id) });
      return `rec_receipts ${beeTodoIds.length}${beeTodoIds.length ? ` (bee todos ${beeTodoIds.join(", ")})` : ""}`;
    },
  },
  {
    name: "episodes",
    run: async (ctx) => {
      const r = await forgetPersonInEpisodes(ctx.recommenderFirstName, { sql: sqlOver(ctx.c), del: (url) => del(url) }, ctx.savedAt);
      return `episodes ${r.episodeIds.length}${ids(r.episodeIds)}, audio ${r.audioDeleted}`;
    },
  },
];
