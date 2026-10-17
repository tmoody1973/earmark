// Draft one bloomed cluster now (real Gateway + Bee), e.g. after "[draft] cluster=<id> gave up after 3 attempts".
//
//   tsx --env-file=.env.local scripts/draft-one-pager.ts <clusterId> [--reset] [--yes-prod]
//
// --reset     sets draft_attempts = 0 and clears draft_claimed_at first (only while the cluster has no draft).
// --yes-prod  required when DATABASE_URL is not the TEST_DATABASE_URL value (i.e. production).
// Goes through the same claim as the pipeline, so it never drafts a cluster that is drafted, not ready, or being drafted.
// Prints ids, format, probability and word count only (never the draft or any transcript text).

async function main(): Promise<void> {
  const id = Number(process.argv[2]);
  if (!Number.isInteger(id) || id <= 0) throw new Error("usage: draft-one-pager.ts <clusterId> [--reset] [--yes-prod]");
  const isTest = !!process.env.DATABASE_URL && process.env.DATABASE_URL === process.env.TEST_DATABASE_URL;
  if (!isTest && !process.argv.includes("--yes-prod")) {
    console.error("refusing: DATABASE_URL is not the test branch; pass --yes-prod to run against production");
    process.exit(2);
  }
  console.log(`target ${isTest ? "test" : "PRODUCTION"} cluster=${id}`);

  const { resetDraftAttempts } = await import("../agent/lib/store/ideas");
  const { draftOnePagerForCluster } = await import("../agent/lib/ideas/one-pager");
  const { wordCount } = await import("../agent/lib/pipeline/excerpt");
  if (process.argv.includes("--reset")) {
    await resetDraftAttempts(id);
    console.log(`cluster=${id} draft attempts reset`);
  }
  const started = Date.now();
  const r = await draftOnePagerForCluster(id);
  console.log(r
    ? `cluster=${id} drafted format=${r.format} p=${r.probability.toFixed(2)} words=${wordCount(r.draft)} (${Date.now() - started} ms)`
    : `cluster=${id} not drafted: not ready, already drafted, being drafted, out of attempts (use --reset), or the draft failed (see [draft] log)`);
}

main().catch((err: unknown) => {
  console.error(`failed error=${err instanceof Error ? err.name : "unknown"}`);
  process.exit(1);
});
