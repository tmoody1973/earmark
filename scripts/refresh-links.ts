// On-demand backlink refresh (the hourly schedule's work, once). Runs on the Neon TEST branch unless `--prod` is given:
// a production run is Tarik's call, never a default.
//   pnpm links:refresh [--max-calls N] [--prod]
export {};
const prod = process.argv.includes("--prod");
const at = process.argv.indexOf("--max-calls");
const maxCalls = at >= 0 ? Number(process.argv[at + 1]) : undefined;
if (maxCalls !== undefined && (!Number.isSafeInteger(maxCalls) || maxCalls < 0)) throw new Error("--max-calls takes a whole number");

const target = prod ? "DATABASE_URL" : "TEST_DATABASE_URL";
if (!process.env[target]) throw new Error(`${target} is not set`);
process.env.DATABASE_URL = process.env[target]; // before db() is first called: it reads DATABASE_URL lazily
console.log(`target ${target}`);

const { refreshLinks } = await import("../agent/lib/links/refresh");
refreshLinks({ maxCalls })
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(`[links] refresh failed error=${err instanceof Error ? err.name : "unknown"}`);
    process.exit(1);
  });
