import { defineSchedule } from "eve/schedules";
import { skipInDemo } from "../lib/demo";
import { runIdeaResearch } from "../lib/ideas/research";
import { sweepRecLane } from "../lib/recs/lane";

const errName = (err: unknown) => (err instanceof Error ? err.name : "unknown");

// The rec lane (M3-T4, decision 013): look up pending tips (MusicBrainz, Open Library, Wikipedia, iTunes podcasts; TMDB,
// Places and Podcast Index once keyed). The only place providers are called (decision 012). Bounded per run and
// non-overlapping (a 15-min lease row in sync_cursors) inside sweepRecLane. Handler form: no model session. Logs counts and error names only.
// First, idea research the owner asked for (decision 057): at most 2 ideas, its own per-idea lease, off without
// TINYFISH_API_KEY. Its failure is logged and never stops the sweep.
export default defineSchedule({
  cron: "*/10 * * * *",
  async run() {
    if (skipInDemo("rec-lane")) return; // the judge demo is read-only (decision 053)
    try {
      console.log("[research] done", JSON.stringify(await runIdeaResearch()));
    } catch (err) {
      console.error(`[research] failed error=${errName(err)}`);
    }
    try {
      console.log("[rec-lane] done", JSON.stringify(await sweepRecLane()));
    } catch (err) {
      console.error(`[rec-lane] sweep failed error=${errName(err)}`);
      throw new Error(errName(err)); // never the message: a BeeApiError carries Bee's response body
    }
  },
});
