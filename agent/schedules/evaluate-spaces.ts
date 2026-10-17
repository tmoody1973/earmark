import { defineSchedule } from "eve/schedules";
import { evaluateSpaces } from "../lib/spaces/evaluate";

// FR-32 Smart Spaces: every hour at :37 (away from the backlinks run at :07), judge the items new or changed since
// they were last judged for each Space, and the backlog a new Space's first fill left. Bounded: at most
// MAX_CALLS_PER_RUN Jev calls a run, MAX_CALLS_PER_SPACE per Space (evaluate.ts, decision 028). Sub-daily cron needs
// the Pro team (M2-T2). Handler form (run): no model session. Logs counts, ids and error names only.
export default defineSchedule({
  cron: "37 * * * *",
  async run() {
    try {
      await evaluateSpaces();
    } catch (err) {
      console.error(`[spaces] evaluate failed error=${err instanceof Error ? err.name : "unknown"}`);
      throw err;
    }
  },
});
