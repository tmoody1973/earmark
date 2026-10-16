// Live check for M2-T7 on the Neon TEST branch only, with REAL Gateway and Bee calls:
// seeds one idea said three ways on three fake occasions, blooms it through the real path (planIdeaClusters: embed →
// Jev cluster choice → Haiku timeline note; then buildSaveQueries' join statement), runs the real draft step
// (Bee neural + fact search, Jev format choice, Sonnet one-pager), then runs it again to show no second draft.
//
//   DATABASE_URL=<the TEST_DATABASE_URL value> tsx --env-file=.env.local scripts/draft-live-check.ts
//
// It refuses to run unless DATABASE_URL equals TEST_DATABASE_URL. Bee is read only (search). Prints ids, the chosen
// format, counts and the first lines of the draft (written from the invented mentions below).
import type { SaveItem } from "../agent/lib/pipeline/save-item";

function guard(): void {
  const target = process.env.DATABASE_URL;
  if (!target || !process.env.TEST_DATABASE_URL || target !== process.env.TEST_DATABASE_URL) {
    console.error("refusing: DATABASE_URL must be set to the TEST_DATABASE_URL value for this script");
    process.exit(2);
  }
}

const RUN = Date.now();
const CONV_BASE = 9_700_000_000; // fake conversation ids (test branch only)
const TITLE = "CRM for public radio stations";
const MENTIONS = [
  { at: "2026-09-12T16:20:00Z", excerpt: "what public radio really needs is a CRM built for stations, members, underwriters and volunteers in one place" },
  { at: "2026-10-03T21:05:00Z", excerpt: "I keep coming back to that public radio CRM, something that connects donors to the shows they actually listen to" },
  { at: "2026-10-15T14:40:00Z", excerpt: "the CRM for public radio again, maybe start small with our own membership data and one simple dashboard" },
];

async function main(): Promise<void> {
  guard();
  // Imported after the guard so nothing can open a connection to another database first.
  const { db } = await import("../agent/lib/db");
  const { planIdeaClusters } = await import("../agent/lib/ideas/compost");
  const { buildSaveQueries, savedIds } = await import("../agent/lib/pipeline/save-item");
  const { draftBlooms, gateContext, writeOnePager } = await import("../agent/lib/ideas/one-pager");
  const { wordCount } = await import("../agent/lib/pipeline/excerpt");
  const sql = db();
  // Fresh start (test branch only): an earlier run's cluster would absorb mentions 2 and 3.
  const old = await sql`delete from idea_clusters where title = ${TITLE} returning id`;
  if (old.length) console.log(`removed earlier check clusters ${old.map((r) => r.id).join(",")}`);

  let clusterId: number | null = null;
  for (const [i, m] of MENTIONS.entries()) {
    const item: SaveItem = {
      kind: "idea", route: "accept", extraction: { title: TITLE, excerpt: m.excerpt },
      beeConversationId: CONV_BASE + (RUN % 1_000_000) * 10 + i, beeJournalId: null, spokenAt: new Date(m.at),
      confidence: 0.92, source: "ambient",
    };
    let [planned] = await planIdeaClusters([item]);
    let plan = planned?.kind === "idea" ? planned.cluster : undefined;
    // The first mention must start its own cluster (an older test row on a similar topic must not absorb it).
    if (i === 0 && plan?.action === "join") {
      console.log(`mention 1 planned a join to old test cluster ${plan.clusterId}; forcing create`);
      planned = { ...(planned as Extract<SaveItem, { kind: "idea" }>), cluster: { action: "create", embedding: plan.embedding, timelineNote: plan.timelineNote } };
      plan = (planned as Extract<SaveItem, { kind: "idea" }>).cluster;
    }
    if (i > 0 && !(plan?.action === "join" && plan.clusterId === clusterId)) {
      console.error(`mention ${i + 1}: Jev did not join cluster ${clusterId} (plan=${plan?.action ?? "none"}); stopping`);
      process.exit(1);
    }
    const saved = savedIds([planned!], await sql.transaction((txn) => buildSaveQueries(txn, planned!)));
    clusterId = saved.ideaClusterIds[0]!;
    console.log(`mention ${i + 1}: plan=${plan?.action} cluster=${clusterId} bloomed=${saved.bloomedClusterIds.includes(clusterId)}`);
  }
  const id = clusterId!;

  let raw = "";
  const deps = {
    writeOnePager: async (input: Parameters<typeof writeOnePager>[0]) => (raw = await writeOnePager(input)),
    // Shows each Bee result's gate decision (first 70 chars of the summary: real Bee data, local console only).
    gateContext: async (input: Parameters<typeof gateContext>[0]) => {
      const g = await gateContext(input);
      input.related.forEach((n, i) => console.log(`gate rel_${i} p_same=${g.probabilities.related[i]!.toFixed(2)} ${g.related.includes(n) ? "KEPT" : "dropped"} | ${n.slice(0, 70)}`));
      input.facts.forEach((f, i) => console.log(`gate fact_${i} p_rel=${g.probabilities.facts[i]!.toFixed(2)} ${g.facts.includes(f) ? "KEPT" : "dropped"} | ${f.slice(0, 70)}`));
      return g;
    },
  };
  const started = Date.now();
  const [r] = await draftBlooms({ clusterIds: [id], deps });
  const ms = Date.now() - started;
  if (!r) {
    console.error(`no draft for cluster ${id}`);
    process.exit(1);
  }
  const quotes = (t: string) => [...t.matchAll(/["“]([^"”\n]+)["”]/g)].map((q) => wordCount(q[1]!));
  console.log(`\nformat=${r.format} p=${r.probability.toFixed(2)} elapsed=${ms}ms body_words=${wordCount(raw)} draft_words=${wordCount(r.draft)}`);
  console.log(`quotes: raw=${quotes(raw).length} raw_over_25=${quotes(raw).filter((n) => n > 25).length} final=${quotes(r.draft).length} final_max_words=${Math.max(0, ...quotes(r.draft))}`);
  console.log("first 8 lines:\n" + r.draft.split("\n").slice(0, 8).join("\n"));

  const again = await draftBlooms({ clusterIds: [id] });
  const [row] = await sql`select stage, draft_format, draft_attempts, (draft_md = ${r.draft}) as same from idea_clusters where id = ${id}`;
  console.log(`\nre-run drafted=${again.length} stage=${row!.stage} format=${row!.draft_format} attempts=${row!.draft_attempts} draft_unchanged=${row!.same}`);
}

main().catch((err: unknown) => {
  console.error(`failed error=${err instanceof Error ? err.name : "unknown"}`);
  process.exit(1);
});
