import { defineSchedule } from "eve/schedules";
import { skipInDemo } from "../lib/demo";
import { runBackfill } from "../lib/pipeline/backfill";

// eve 0.80.0 deploys the schedule consumer with Vercel `maxDuration: "max"`. Confirmed M2-T2: this Pro project runs Fluid
// Compute, where "max" is 800 s (Vercel limits doc, Pro/Enterprise), strictly under the 15-minute CLAIM_LEASE (900 s).
// runBackfill stops claiming new items at 70% of the budget (~546 s), leaving ~234 s for the in-flight one before the kill.
const BUDGET_MS = 780_000;

// FR-02: the Bee stream is at-most-once, so re-read the last 48 h every night. 08:00 UTC = 03:00 Central.
// Handler form (run): no model session is started; the pipeline calls the models itself.
export default defineSchedule({
  cron: "0 8 * * *",
  async run() {
    if (skipInDemo("nightly-backfill")) return; // the judge demo is read-only (decision 053)
    const result = await runBackfill({ budgetMs: BUDGET_MS });
    console.log("[backfill] done", result);
  },
});
