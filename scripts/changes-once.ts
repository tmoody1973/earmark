// One-off local run of the /v1/changes sync against the real account (what the 10-minute schedule does).
// Prints the result object and the sync_cursors row only (no transcript text).
import { db } from "../agent/lib/db";
import { BEE_CHANGES_CURSOR, runBeeChangesSync } from "../agent/lib/sync/bee-changes";

console.log("result", await runBeeChangesSync());
const rows = await db()`select name, cursor, updated_at from sync_cursors where name = ${BEE_CHANGES_CURSOR}`;
console.log("sync_cursors", rows);
