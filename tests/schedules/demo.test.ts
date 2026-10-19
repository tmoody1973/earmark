import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The judge demo (decision 053): every schedule is a no-op, so the demo's database is never written and no provider,
// model or Bee call is made, even if the demo project deploys the crons.
vi.mock("eve/schedules", () => ({ defineSchedule: <T>(s: T) => s }));
const work = vi.hoisted(() => {
  const fail = () => { throw new Error("background work ran in demo mode"); };
  return {
    runBeeChangesSync: vi.fn(fail), draftBlooms: vi.fn(fail), drainTodoQueue: vi.fn(fail), handleRecTodoChange: vi.fn(fail),
    evaluateSpaces: vi.fn(fail), proposeIdeaFacts: vi.fn(fail), proposeTasteFacts: vi.fn(fail), writePendingProposals: vi.fn(fail),
    runDueGardeners: vi.fn(fail), runBackfill: vi.fn(fail), sweepRecLane: vi.fn(fail), refreshLinks: vi.fn(fail),
  };
});
vi.mock("../../agent/lib/sync/bee-changes", () => ({ runBeeChangesSync: work.runBeeChangesSync }));
vi.mock("../../agent/lib/ideas/one-pager", () => ({ draftBlooms: work.draftBlooms }));
vi.mock("../../agent/lib/sync/bee-todos", () => ({ drainTodoQueue: work.drainTodoQueue }));
vi.mock("../../agent/lib/sync/todo-handlers", () => ({ handleRecTodoChange: work.handleRecTodoChange }));
vi.mock("../../agent/lib/spaces/evaluate", () => ({ evaluateSpaces: work.evaluateSpaces }));
vi.mock("../../agent/lib/facts/proposals", () => ({
  proposeIdeaFacts: work.proposeIdeaFacts, proposeTasteFacts: work.proposeTasteFacts, writePendingProposals: work.writePendingProposals,
}));
vi.mock("../../agent/lib/gardeners/run", () => ({ runDueGardeners: work.runDueGardeners }));
vi.mock("../../agent/lib/pipeline/backfill", () => ({ runBackfill: work.runBackfill }));
vi.mock("../../agent/lib/recs/lane", () => ({ sweepRecLane: work.sweepRecLane }));
vi.mock("../../agent/lib/links/refresh", () => ({ refreshLinks: work.refreshLinks }));

const NAMES = ["bee-changes", "evaluate-spaces", "fact-proposals", "gardeners", "nightly-backfill", "rec-lane", "refresh-links"];

beforeEach(() => {
  vi.stubEnv("EARMARK_DEMO", "1");
  vi.stubEnv("EARMARK_DEMO_DB_OK", "1");
  vi.stubEnv("EARMARK_PROD_DB_HOST", "ep-busy-prod-654321.us-east-2.aws.neon.tech");
  vi.stubEnv("DATABASE_URL", "postgres://demo_reader:pw@ep-quiet-demo-123456-pooler.us-east-2.aws.neon.tech/neondb");
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => vi.unstubAllEnvs());

describe("schedules in demo mode", () => {
  it.each(NAMES)("%s does nothing", async (name) => {
    const { default: s } = (await import(`../../agent/schedules/${name}.ts`)) as { default: { run: () => Promise<void> } };
    await expect(s.run()).resolves.toBeUndefined();
    for (const fn of Object.values(work)) expect(fn).not.toHaveBeenCalled();
    expect(console.info).toHaveBeenCalledWith(`[${name}] skipped: read-only demo`);
  });
});
