import { neon, type NeonQueryFunction, type PoolClient } from "@neondatabase/serverless";
import { getEnv } from "./env";

let client: NeonQueryFunction<false, false> | undefined;
export function db(): NeonQueryFunction<false, false> {
  client ??= neon(getEnv().DATABASE_URL);
  return client;
}

// One interactive transaction on a Pool client (scripts: resort, forget). `work` decides commit or rollback; a read-only
// transaction cannot write even by mistake.
export async function inTransaction<T>(c: PoolClient, readOnly: boolean, work: () => Promise<{ value: T; commit: boolean }>): Promise<T> {
  await c.query(readOnly ? "begin transaction read only" : "begin");
  try {
    const { value, commit } = await work();
    await c.query(commit ? "commit" : "rollback");
    return value;
  } catch (err) {
    // A failed rollback (dropped connection) must not hide why the transaction failed; Postgres aborts it anyway.
    try {
      await c.query("rollback");
    } catch (rollbackErr) {
      console.error(`[db] rollback failed error=${rollbackErr instanceof Error ? rollbackErr.name : "unknown"}`);
    }
    throw err;
  }
}
