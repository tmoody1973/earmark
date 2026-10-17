// End-to-end tests must never write production (M4-T4). playwright.config.ts starts the dev server with
// EARMARK_E2E=1 and either DATABASE_URL = TEST_DATABASE_URL (default) or, for opt-in real-data runs (E2E_REAL=1),
// GARDEN_READ_ONLY=1. instrumentation.ts runs assertE2eDatabase at server start; the garden's writes check
// gardenReadOnly.

type Env = Record<string, string | undefined>;

/** Garden writes (visit record, idea viewed) are no-ops: a real-data e2e run browses the owner's garden read-only. */
export function gardenReadOnly(env: Env = process.env): boolean {
  return env.GARDEN_READ_ONLY === "1";
}

/** Throws when an e2e server could write a database other than the Neon test branch. */
export function assertE2eDatabase(env: Env = process.env): void {
  if (env.EARMARK_E2E !== "1" || gardenReadOnly(env)) return;
  if (!env.TEST_DATABASE_URL || env.DATABASE_URL !== env.TEST_DATABASE_URL) {
    throw new Error(
      "e2e server refused: DATABASE_URL is not the test branch (TEST_DATABASE_URL) and GARDEN_READ_ONLY is unset. " +
        "Run e2e on the test branch, or E2E_REAL=1 for a read-only real-data run.",
    );
  }
}
