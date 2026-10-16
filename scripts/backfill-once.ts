// One-off local backfill over a wide window. Prints timing and the result object only (no transcript text).
import { runBackfill } from "../agent/lib/pipeline/backfill";

const hours = Number(process.argv[2] ?? 264);
const budgetMs = Number(process.argv[3] ?? 3_600_000);
const start = new Date();
console.log("start", start.toISOString(), { hours, budgetMs });
const result = await runBackfill({ hours, budgetMs });
const end = new Date();
console.log("end", end.toISOString(), `elapsed_s=${Math.round((end.getTime() - start.getTime()) / 1000)}`);
console.log("result", result);
