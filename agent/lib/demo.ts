// The judge demo (decision 053, docs/demo-mode.md): read-only Earmark on invented sample data at its own URL.
// EARMARK_DEMO=1 opens the owner pages to everyone (owner.ts), refuses every write in proxy.ts (demoWriteRefusal), and
// turns background work into no-ops (skipInDemo). The demo database's SELECT-only role is the real guarantee; this
// switch is for a friendly message and quiet logs.
//
// Never on by accident: the switch also needs EARMARK_DEMO_DB_OK=1 and EARMARK_PROD_DB_HOST (the production database's
// host), and refuses DATABASE_URL on that host. A refused switch stays off (the real owner gate) and instrumentation.ts throws.

type Env = Record<string, string | undefined>;

export const DEMO_BANNER = "Demo · sample data · read-only. Earmark's real garden is private.";
export const DEMO_READ_ONLY = "This is a read-only demo.";
/** proxy.ts marks its refusals with this header; the banner (app/DemoBanner.tsx) shows DEMO_READ_ONLY when it sees one. */
export const DEMO_HEADER = "x-earmark-demo";

// Neon's pooled host is the direct host with "-pooler" after the endpoint id: both are the same database.
const hostOf = (v: string): string | null => {
  const host = URL.canParse(v) ? new URL(v).hostname : /^[a-z0-9.-]+$/i.test(v) ? v : null;
  return host ? host.toLowerCase().replace("-pooler.", ".") : null;
};

/** Why demo mode must not start (no URL or password in it), or null when it may, or when it is off. */
export function demoProblem(env: Env = process.env): string | null {
  if (env.EARMARK_DEMO !== "1") return null;
  if (env.EARMARK_DEMO_DB_OK !== "1") return "EARMARK_DEMO=1 needs EARMARK_DEMO_DB_OK=1 (the demo database, with a SELECT-only role)";
  const prod = env.EARMARK_PROD_DB_HOST?.trim();
  if (!prod) return "EARMARK_DEMO=1 needs EARMARK_PROD_DB_HOST so it can refuse the production database";
  const db = env.DATABASE_URL && URL.canParse(env.DATABASE_URL) ? hostOf(env.DATABASE_URL) : null;
  if (!db) return "DATABASE_URL is missing or unreadable";
  return db === hostOf(prod) ? "DATABASE_URL is the production database (EARMARK_PROD_DB_HOST)" : null;
}

export function isDemo(env: Env = process.env): boolean {
  return env.EARMARK_DEMO === "1" && demoProblem(env) === null;
}

/** instrumentation.ts, at server start: a misconfigured demo refuses to start rather than run as anything else. */
export function assertDemoSafe(env: Env = process.env): void {
  const problem = demoProblem(env);
  if (problem) throw new Error(`demo mode refused: ${problem}. See docs/demo-mode.md.`);
}

/**
 * The one write guard (proxy.ts runs it before every request, server actions included): in demo mode anything but a
 * read is refused before any action or route code runs. Null: carry on.
 */
export function demoWriteRefusal(method: string, env: Env = process.env): Response | null {
  if (!isDemo(env) || ["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) return null;
  return Response.json({ error: DEMO_READ_ONLY }, {
    status: 403,
    headers: { [DEMO_HEADER]: "read-only", "cache-control": "no-store" },
  });
}

/** Background work (schedules) calls this first: true means do nothing, the demo is read-only. */
export function skipInDemo(job: string, env: Env = process.env): boolean {
  if (!isDemo(env)) return false;
  console.info(`[${job}] skipped: read-only demo`);
  return true;
}
