// Replays one real, completed Bee conversation through the LIVE path (handleLiveUtterance), utterance by utterance,
// with real Gateway calls, against the Neon TEST branch only. Then runs the completed-conversation pass for the same
// conversation and shows it adds no second mention (one occasion).
//
//   DATABASE_URL=<the TEST_DATABASE_URL value> tsx --env-file=.env.local scripts/replay-live.ts <conversationId> [--seed] [--max N]
//
// --seed  first saves the conversation twice through the completed pass under two fake conversation ids (two earlier
//         "occasions"), so every idea it holds already has 2 mentions and the live replay is its 3rd: a bloom.
// --max N feed only the first N utterances.
// Bee is read only (GET /v1/conversations/:id). Output is ids, counts and timings only: never transcript text or titles.
// It refuses to run unless DATABASE_URL equals TEST_DATABASE_URL.
import { pathToFileURL } from "node:url";

const SEED_BASE = 9_600_000_000; // fake conversation ids for seeded occasions (test branch only)

function guard(): void {
  const target = process.env.DATABASE_URL;
  if (!target || !process.env.TEST_DATABASE_URL || target !== process.env.TEST_DATABASE_URL) {
    console.error("refusing: DATABASE_URL must be set to the TEST_DATABASE_URL value for this script");
    process.exit(2);
  }
}

async function main(): Promise<void> {
  guard();
  const id = Number(process.argv[2]);
  if (!Number.isInteger(id) || id <= 0) throw new Error("usage: replay-live.ts <conversationId> [--seed] [--max N]");
  const seed = process.argv.includes("--seed");
  const maxAt = process.argv.indexOf("--max");
  const max = maxAt > 0 ? Number(process.argv[maxAt + 1]) : Number.POSITIVE_INFINITY;

  // Imported after the guard so nothing can open a connection to another database first.
  const { db } = await import("../agent/lib/db");
  const { createBeeClient } = await import("../agent/lib/bee/client");
  const { handleLiveUtterance } = await import("../agent/lib/pipeline/live");
  const { processConversation } = await import("../agent/lib/pipeline/process-conversation");
  const { rememberConversationUuid } = await import("../agent/lib/store/conversations");
  const { chooseCluster } = await import("../agent/lib/ideas/choose-cluster");
  const sql = db();

  const bee = createBeeClient();
  const { conversation } = await bee.getConversation(id);
  const transcription = conversation.transcriptions.find((t) => t.realtime) ?? conversation.transcriptions[0];
  const utterances = (transcription?.utterances ?? []).slice(0, max);
  const uuid = `replay-${id}-${Date.now()}`;
  console.log(`conversation=${id} state=${conversation.state} utterances=${utterances.length} realtime=${transcription?.realtime ?? false} uuid=${uuid}`);

  // A clean slate on the TEST branch for this conversation and earlier replays' seeds.
  await sql`delete from idea_clusters where id in (select cluster_id from idea_mentions
              where bee_conversation_id = ${id} or bee_conversation_id between ${SEED_BASE} and ${SEED_BASE + 99_999_999}
                 or bee_conversation_uuid like ${`replay-${id}-%`})`;
  await sql`delete from recommendations where bee_conversation_id = ${id} or bee_conversation_id between ${SEED_BASE} and ${SEED_BASE + 99_999_999}`;
  await sql`delete from processed_conversations where bee_conversation_id = ${id} or bee_conversation_id between ${SEED_BASE} and ${SEED_BASE + 99_999_999}`;
  await sql`delete from bee_conversation_map where bee_conversation_id = ${id}`;
  await sql`delete from utterance_buffer where conversation_uuid like ${`replay-${id}-%`}`;
  const startedAt = new Date();

  if (seed) {
    for (const k of [1, 2]) {
      const fake = SEED_BASE + (id % 1_000_000) * 10 + k;
      const asFake = { ...bee, getConversation: async () => ({ conversation: { ...conversation, id: fake }, timezone: "America/Chicago" }) };
      const r = await processConversation(fake, { bee: asFake as typeof bee });
      console.log(`seed occasion ${k}: conversation=${fake} ideas=${r.ideas} recs=${r.recs} reviews=${r.reviews} clusters=${r.saved.ideaClusterIds.join(",") || "-"}`);
    }
  }

  // The new-conversation event would have mapped the stream uuid to the REST id (the live capturing lookup can't
  // find a COMPLETED conversation, so the replay plays that event).
  await rememberConversationUuid(uuid, id);

  let windows = 0, claims = 0, ideas = 0;
  const blooms: number[] = [];
  const timings: number[] = [];
  for (const u of utterances) {
    const t0 = Date.now();
    const r = await handleLiveUtterance({ conversationUuid: uuid, speaker: u.speaker, text: u.text, utteranceId: u.id ?? null });
    if (r.triaged) {
      claims++;
      windows += r.windows;
      ideas += r.ideas;
      timings.push(Date.now() - t0);
      blooms.push(...(r.saved?.bloomedClusterIds ?? []));
      if (r.ideas > 0) console.log(`live window claim ${claims}: ideas=${r.ideas} clusters=${r.saved!.ideaClusterIds.join(",")} blooms=${r.saved!.bloomedClusterIds.join(",") || "-"} ms=${timings.at(-1)}`);
    }
  }
  const sorted = [...timings].sort((a, b) => a - b);
  console.log(`live: claims=${claims} windows=${windows} ideas_saved=${ideas} blooms=${blooms.join(",") || "-"} ` +
    `ms_p50=${sorted[Math.floor(sorted.length / 2)] ?? 0} ms_max=${sorted.at(-1) ?? 0}`);

  const byKind = await sql`select kind, count(*)::int as n from garden_events where created_at >= ${startedAt.toISOString()}::timestamptz group by 1 order by 1`;
  console.log(`garden_events since start: ${byKind.map((r) => `${r.kind}=${r.n}`).join(" ") || "none"}`);
  const live = await sql`select cluster_id, count(*)::int as n from idea_mentions where bee_conversation_uuid = ${uuid} group by 1 order by 1`;
  const before = await sql`select id, mention_count, stage, jsonb_array_length(coalesce(timeline, '[]'::jsonb)) as lines
                           from idea_clusters where id = any(${live.map((r) => Number(r.cluster_id))}::bigint[]) order by id`;
  console.log(`clusters touched live: ${before.map((c) => `#${c.id} n=${c.mention_count} ${c.stage} lines=${c.lines}`).join("; ") || "none"}`);

  // The completed pass of the SAME conversation: its ideas must find the live mentions and add nothing. The cluster
  // choice is wrapped (same real Jev call) to show each idea was found and matched, then dropped as the same occasion.
  const chosen: string[] = [];
  const counted = async (idea: { title: string; excerpt: string }, options: Parameters<typeof chooseCluster>[1]) => {
    const r = await chooseCluster(idea, options);
    chosen.push(r.key ?? "new");
    return r;
  };
  const done = await processConversation(id, { bee, compost: { chooseCluster: counted } });
  console.log(`completed pass: ideas_planned=${chosen.length} chose=${chosen.join(",") || "-"} saved ideas=${done.ideas} recs=${done.recs} ` +
    `reviews=${done.reviews} clusters=${done.saved.ideaClusterIds.join(",") || "-"}`);
  const after = await sql`select id, mention_count, stage, jsonb_array_length(coalesce(timeline, '[]'::jsonb)) as lines
                          from idea_clusters where id = any(${live.map((r) => Number(r.cluster_id))}::bigint[]) order by id`;
  console.log(`same clusters after: ${after.map((c) => `#${c.id} n=${c.mention_count} ${c.stage} lines=${c.lines}`).join("; ") || "none"}`);
  const perOccasion = await sql`select cluster_id, count(*)::int as n from idea_mentions
                                where bee_conversation_id = ${id} or bee_conversation_uuid = ${uuid} group by 1 having count(*) > 1`;
  console.log(`clusters with >1 mention from this conversation: ${perOccasion.length}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(`replay failed error=${err instanceof Error ? err.name : "unknown"}`);
    process.exit(1);
  });
}
