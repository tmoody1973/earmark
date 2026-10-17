import { defineSchedule } from "eve/schedules";
import { refreshLinks } from "../lib/links/refresh";

// FR-38 backlinks: every hour at :07, judge the idea pairs and tip→idea fits that are new or changed since they were
// last judged. Bounded: at most MAX_CALLS_PER_RUN model calls a run, MAX_CALLS_PER_ITEM per idea or tip (refresh.ts,
// decision 026). Sub-daily cron needs the Pro team (M2-T2). Handler form (run): no model session; refresh calls Jev.
// Logs counts, ids and error names only (refresh.ts logs its own one-line summary).
export default defineSchedule({
  cron: "7 * * * *",
  async run() {
    try {
      await refreshLinks();
    } catch (err) {
      console.error(`[links] refresh failed error=${err instanceof Error ? err.name : "unknown"}`);
      throw new Error(err instanceof Error ? err.name : "unknown"); // never the message: a BeeApiError carries Bee's response body
    }
  },
});
