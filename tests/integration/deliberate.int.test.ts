import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { BeeClient } from "../../agent/lib/bee/client";
import type { PipelineDeps } from "../../agent/lib/pipeline/process-conversation";
import type { TriageResult } from "../../agent/lib/types";

// Real Neon test on the `test` branch: needs TEST_DATABASE_URL (never production). Skipped when absent.
// Every model dependency is a fake: no Gateway call from this file (the fetch guard below proves it).
const RUN = Date.now() % 1_000_000_000;
const CONV = 9_500_000_000 + RUN * 10;
const DIM = 1100 + (RUN % 300); // a direction no other test row uses
const unit = (i: number) => Array.from({ length: 1536 }, (_, j) => (j === i ? 1 : 0));
const SLOW = 30_000;
const OWNER = "Odette";

// The four real lines (verbatim) + an owner line + an idea, among ordinary talk. Ids are Bee-style numbers.
const UTTERANCES = [
  { id: 101, text: "so we are agreed on the budget for next quarter" },
  { id: 102, text: "Earmark that spot as known for Omakase called 1033 here in Walker's Point." },
  { id: 103, text: "Earmark that I should listen to Jemetta Rose's new albums as a tribute to Sun Raw Records." },
  { id: 104, text: "Remark that Chris says to try that Notion calendar app." },
  { id: 105, text: "Earmark that the syntax guys told me to check out this new repo called PyPI Durable." },
  { id: 106, text: "Earmark that Odette says to try Ardent Records on Brady Street." },
  { id: 107, text: "Earmark that an idea for a weekly segment about Milwaukee record stores." },
  { id: 108, text: "you have to try the Ardent sandwich, Ann says" },
  { id: 109, text: "anyway I should get going" },
];

const tri = (over: Partial<TriageResult>): TriageResult => ({
  kind: "rec_to_user", kindProbability: 0.95, recType: "other", recTypeProbability: 0.9, jokingProbability: 0.02,
  broadcastProbability: 0.01, model: "fake", providerMetadata: null, ...over,
});

describe.skipIf(!process.env.TEST_DATABASE_URL)("'Earmark that' anywhere in a conversation (real Neon)", () => {
  const realFetch = globalThis.fetch;
  const outside: string[] = [];
  const windowTexts: string[] = [];
  let ambientOn = true;
  const prevOwner = process.env.EARMARK_OWNER_FIRST_NAME;

  beforeAll(() => {
    process.env.EARMARK_OWNER_FIRST_NAME = OWNER;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!/neon\.tech/.test(new URL(url).host)) {
        outside.push(new URL(url).host);
        throw new Error(`unexpected network call to ${new URL(url).host}`);
      }
      return realFetch(input, init);
    }) as typeof fetch;
  });
  afterEach(() => expect(outside).toEqual([]));
  afterAll(async () => {
    globalThis.fetch = realFetch;
    if (prevOwner === undefined) delete process.env.EARMARK_OWNER_FIRST_NAME;
    else process.env.EARMARK_OWNER_FIRST_NAME = prevOwner;
    const { db } = await import("../../agent/lib/db");
    const sql = db();
    await sql`delete from recommendations where bee_conversation_id = ${CONV}`;
    await sql`delete from idea_clusters where id in (select cluster_id from idea_mentions where bee_conversation_id = ${CONV})`;
    await sql`delete from processed_conversations where bee_conversation_id = ${CONV}`;
  });

  const bee = () => ({
    getConversation: async () => ({
      conversation: {
        id: CONV, state: "COMPLETED", start_time: Date.parse("2026-10-16T18:20:00Z"), end_time: Date.parse("2026-10-16T18:30:00Z"),
        summary: null, short_summary: null,
        transcriptions: [{ realtime: false, utterances: UTTERANCES.map((u, i) => ({ ...u, speaker: "Unknown", spoken_at: Date.parse("2026-10-16T18:23:00Z") + i * 1000 })) }],
      },
    }),
  }) as unknown as BeeClient;

  const deps = (): Partial<PipelineDeps> => ({
    bee: bee(),
    now: () => new Date("2026-10-16T18:40:00Z"),
    // Deliberate bodies arrive as "Unknown: <body>"; ambient windows as several labelled lines.
    triage: async (text: string) => {
      windowTexts.push(text);
      if (text.includes("Omakase")) return tri({ recType: "place" });
      if (text.includes("Jemetta")) return tri({ recType: "album" });
      if (text.includes("idea for")) return tri({ kind: "idea_by_user", recType: "none" });
      if (text.includes("Ardent sandwich") && ambientOn) return tri({ recType: "place" });
      return text.includes("Chris") || text.includes("syntax") || text.includes("Odette") ? tri({}) : tri({ kind: "neither" });
    },
    extractRecommendation: async ({ text }) => {
      const pick = (canonicalName: string, recommenderName: string | null) => ({ canonicalName, creator: null, recommenderName, excerpt: text.split(/\s+/).slice(0, 12).join(" ") });
      if (text.includes("Omakase")) return pick("Omakase 1033", null);
      if (text.includes("Jemetta")) return pick("Jemetta Rose albums", null);
      if (text.includes("Chris")) return pick("Notion Calendar", "Chris");
      if (text.includes("syntax")) return pick("PyPI Durable", "Syntax"); // a group is not a name: the text has no capital "Syntax"
      if (text.includes("Odette")) return pick("Ardent Records", OWNER);
      return pick("Ardent sandwich", "Ann");
    },
    extractIdea: async () => ({ title: "IT: record store segment", excerpt: "a weekly segment about Milwaukee record stores" }),
    compost: { embedText: async () => unit(DIM), chooseCluster: async () => ({ key: null }), writeTimelineNote: async () => "first heard" },
  });

  it("saves one deliberate item per 'Earmark that' with voice review status and attribution, none from ambient", async () => {
    const { processConversation } = await import("../../agent/lib/pipeline/process-conversation");
    const { db } = await import("../../agent/lib/db");
    const r = await processConversation(CONV, deps());
    expect(r).toMatchObject({ skipped: false, incomplete: false, failed: 0 });
    expect(r.saved.recIds).toHaveLength(6); // 5 earmarked recs + 1 ambient (Ardent sandwich)
    expect(r.saved.mentionIds).toHaveLength(1);

    // The earmarked lines never reach ambient triage (other tests' windows could not contain these words).
    expect(windowTexts.filter((t) => /Omakase|Jemetta|Notion|Durable|record stores/.test(t) && t.split("\n").length > 1)).toEqual([]);

    const sql = db();
    const rows = await sql`select r.canonical_name, r.type, r.status, r.source, r.attribution_source, r.deliberate_key, r.confidence, rc.first_name
                           from recommendations r left join recommenders rc on rc.id = r.recommender_id
                           where r.bee_conversation_id = ${CONV} order by r.canonical_name`;
    const by = Object.fromEntries(rows.map((x) => [x.canonical_name as string, x]));
    expect(Object.keys(by).sort()).toEqual(["Ardent Records", "Ardent sandwich", "Jemetta Rose albums", "Notion Calendar", "Omakase 1033", "PyPI Durable"]);
    expect(by["Omakase 1033"]).toMatchObject({ type: "place", status: "new", source: "voice", attribution_source: "none", first_name: null, deliberate_key: "u102", confidence: 1 });
    expect(by["Jemetta Rose albums"]).toMatchObject({ type: "album", status: "new", first_name: null, deliberate_key: "u103" });
    expect(by["Notion Calendar"]).toMatchObject({ type: "other", status: "new", attribution_source: "voice_trigger", first_name: "Chris", deliberate_key: "u104" });
    expect(by["PyPI Durable"]).toMatchObject({ first_name: null, attribution_source: "none", deliberate_key: "u105" }); // group, not a name
    expect(by["Ardent Records"]).toMatchObject({ first_name: null, attribution_source: "none", deliberate_key: "u106" }); // owner never credited
    expect(by["Ardent sandwich"]).toMatchObject({ source: "ambient", deliberate_key: null, first_name: "Ann", attribution_source: "second_person" });

    const [mention] = await sql`select review_status, source, deliberate_key, confidence from idea_mentions where bee_conversation_id = ${CONV}`;
    expect(mention).toMatchObject({ review_status: "accepted", source: "voice", deliberate_key: "u107", confidence: 1 });
  }, SLOW);

  it("a claim already done skips; after a released claim a re-run saves exactly one item per earmark", async () => {
    const { processConversation } = await import("../../agent/lib/pipeline/process-conversation");
    const { db } = await import("../../agent/lib/db");
    expect(await processConversation(CONV, deps())).toMatchObject({ skipped: true });

    const sql = db();
    await sql`delete from processed_conversations where bee_conversation_id = ${CONV}`; // a released claim
    ambientOn = false; // keep the ambient lane quiet so only the deliberate keys are under test
    const r = await processConversation(CONV, deps());
    expect(r).toMatchObject({ skipped: false });
    expect(r.saved.recIds).toHaveLength(0);
    expect(r.saved.mentionIds).toHaveLength(0);

    const keys = await sql`select deliberate_key, count(*)::int as n from (
                             select deliberate_key from recommendations where bee_conversation_id = ${CONV} and deliberate_key is not null
                             union all select deliberate_key from idea_mentions where bee_conversation_id = ${CONV} and deliberate_key is not null) k
                           group by deliberate_key order by deliberate_key`;
    expect(keys.map((k) => [k.deliberate_key, k.n])).toEqual([["u102", 1], ["u103", 1], ["u104", 1], ["u105", 1], ["u106", 1], ["u107", 1]]);
  }, SLOW);

  it("the database refuses a second item with the same conversation and key", async () => {
    const { db } = await import("../../agent/lib/db");
    const sql = db();
    await expect(sql`insert into recommendations (type, raw_text, canonical_name, excerpt, bee_conversation_id, deliberate_key, said_at, source, confidence)
                     values ('other', 'x', 'dup', 'x', ${CONV}, 'u102', now(), 'voice', 1)`).rejects.toThrow();
  }, SLOW);
});
