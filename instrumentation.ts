import { assertDemoSafe } from "./agent/lib/demo";
import { assertE2eDatabase } from "./agent/lib/e2e-guard";

// Runs once when the server starts. An e2e server (EARMARK_E2E=1, set by playwright.config.ts) refuses to start
// unless it reads the Neon test branch or is read-only (GARDEN_READ_ONLY=1): e2e never writes production.
// A misconfigured judge demo (EARMARK_DEMO=1, decision 053) refuses to start too (agent/lib/demo.ts).
export function register() {
  assertE2eDatabase();
  assertDemoSafe();
}
