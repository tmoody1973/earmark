// On-demand Smart Spaces pass (the hourly schedule's work, once). Runs on the Neon TEST branch unless `--prod` is given:
// a production run is Tarik's call, never a default.
//   pnpm spaces:evaluate [--space ID] [--max-calls N] [--prod]
export {};
const prod = process.argv.includes("--prod");
const arg = (flag: string) => {
  const at = process.argv.indexOf(flag);
  if (at < 0) return undefined;
  const n = Number(process.argv[at + 1]);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`${flag} takes a whole number`);
  return n;
};
const maxCalls = arg("--max-calls");
const spaceId = arg("--space");

const target = prod ? "DATABASE_URL" : "TEST_DATABASE_URL";
if (!process.env[target]) throw new Error(`${target} is not set`);
process.env.DATABASE_URL = process.env[target]; // before db() is first called: it reads DATABASE_URL lazily
console.log(`target ${target}`);

const { evaluateSpaces } = await import("../agent/lib/spaces/evaluate");
evaluateSpaces({ maxCalls, spaceId })
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(`[spaces] evaluate failed error=${err instanceof Error ? err.name : "unknown"}`);
    process.exit(1);
  });
