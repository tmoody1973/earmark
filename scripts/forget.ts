// Forget one item everywhere (M3-T11, FR-30, decision 011).
//   pnpm forget <rec|idea|mention> <id>          dry run: read-only, prints ids and table counts
//   pnpm forget <rec|idea|mention> <id> --yes    Bee / Notion / Blob, then one Postgres transaction (rows + hooks)
// Only ever the DATABASE_URL in .env.local. Prints ids, counts and err.name only, never text.
import { pathToFileURL } from "node:url";
import { Pool } from "@neondatabase/serverless";
import { forget, formatPlan, type ForgetTarget } from "../agent/lib/privacy/forget";
import { FORGET_HOOKS } from "../agent/lib/privacy/forget-hooks";
import { databaseUrl } from "./resort";

const USAGE = "usage: pnpm forget <rec|idea|mention> <id> [--yes]  (a dry run unless --yes)";
const TYPES = new Set(["rec", "idea", "mention"]);
const SAFE_ERRORS = new Set(["ForgetRefsChangedError", "ForgetTimelineError", "ForgetHookError"]);

export function parseForgetArgs(argv: readonly string[]): { target: ForgetTarget; yes: boolean } {
  const [type = "", rawId = "", ...flags] = argv;
  const id = Number(rawId);
  const flagOk = flags.length === 0 || (flags.length === 1 && (flags[0] === "--yes" || flags[0] === "--dry-run"));
  if (!TYPES.has(type) || !/^\d+$/.test(rawId) || !Number.isSafeInteger(id) || id <= 0 || !flagOk) throw new Error(USAGE);
  return { target: { type: type as ForgetTarget["type"], id }, yes: flags[0] === "--yes" };
}

async function main(): Promise<void> {
  const { target, yes } = parseForgetArgs(process.argv.slice(2));
  const url = databaseUrl();
  console.log(`database ${new URL(url).hostname.split(".")[0]} (.env.local DATABASE_URL)`);
  const pool = new Pool({ connectionString: url });
  const c = await pool.connect();
  try {
    const r = await forget(c, target, { yes, hooks: FORGET_HOOKS });
    if (!yes) console.log("DRY RUN (read-only, nothing deleted; add --yes to delete)");
    for (const line of formatPlan(r.plan, yes && !r.aborted)) console.log(line);
    if (!yes && r.plan.exists && FORGET_HOOKS.length) console.log(`  then hooks: ${FORGET_HOOKS.map((h) => h.name).join(", ")}`);
    for (const line of r.lines) console.log(`  ${line}`);
    if (r.aborted) {
      console.error("[forget] stopped before the database: nothing in Postgres was deleted. Fix the line above and run the same command again.");
      process.exitCode = 1;
    }
  } finally {
    c.release();
    await pool.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    // Only messages this code wrote (ids, never text) are shown; anything else prints its name alone.
    const ours = err instanceof Error && (/^usage|^refusing/.test(err.message) || SAFE_ERRORS.has(err.name));
    const shown = ours ? ` ${err.message}` : "";
    console.error(`[forget] failed error=${err instanceof Error ? err.name : "unknown"}${shown}`);
    process.exit(1);
  });
}
