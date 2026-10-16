import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { BeeClient } from "../../agent/lib/bee/client";
import type { PipelineDeps } from "../../agent/lib/pipeline/process-conversation";
import type { TriageResult } from "../../agent/lib/types";

// M2-T14 (MOO-938), real Neon `test` branch (TEST_DATABASE_URL, never production). Structural replay of the real
// 2026-10-16 case: five voice notes recorded while Bee was also recording conversation 11338188 (three saved, two cut
// off), and the same five "Earmark that" lines inside the conversation, one of them split by diarization ("Earm" |
// "ark that."). Names are fakes; every model call is a fake (the fetch guard proves no Gateway call).
const RUN = Date.now() % 100_000;
const CONV_A = 9_600_000_000 + RUN * 10;
const CONV_B = CONV_A + 1;
const JID = `zzt14-${RUN}`;
const OWNER = "Odette";
const PEOPLE = ["zzann", "zzanne", "zzmarcus", "zzdana", "zzsam", "zzlena"];
const SLOW = 30_000;
// A time no other test uses: the same-moment check is a time-window query over the whole table.
const baseFor = (k: number) => Date.parse("2030-01-01T00:00:00Z") + (RUN * 2 + k) * 7_200_000;

const CONVERSATION = [
  [0, "so that is the plan for the week"],
  [23, "Done."],
  [44, "Earm"],
  [44, "ark that."],
  [45, "Zzanne's ramen spot, Kawa Ramen"],
  [51, "Earmark that."],
  [52, "Zzmarcus says, listen to Acts of Faith."],
  [57, "Earmark that."],
  [58, "Zzdana song pick, A Little Dark Age."],
  [66, "Earmark That, Zzsam's podcast tip: The Watchables."],
  [73, "Earmark That."],
  [74, "Zzlena says watch Shogun on Hulu."],
  [98, "okay that is all of them"],
  [140, "back to the newsletter draft now"],
] as const;

const VOICE_NOTES = [
  ["kawa", 48.249, "Earmark that Zzann's ramen spot, Kawa Ramen"],
  ["marcus", 54.878, "Earmark that, Zzmarcus says. Listen to Acts of Faith"],
  ["cut1", 58.248, "Earmarked that."], // cut off: not a trigger, saves nothing
  ["cut2", 68.001, "Earmarked that, Zzsam's."], // cut off: not a trigger, saves nothing
  ["lena", 76.469, "Remark that Zzlena says, watch Shogun"],
] as const;

const tri = (over: Partial<TriageResult>): TriageResult => ({
  kind: "rec_to_user", kindProbability: 0.95, recType: "other", recTypeProbability: 0.9, jokingProbability: 0.02,
  broadcastProbability: 0.01, model: "fake", providerMetadata: null, ...over,
});

const ITEMS: [RegExp, TriageResult["recType"], string, string][] = [
  [/Zzanne/, "place", "Kawa Ramen (ramen spot on Brady Street)", "Zzanne"], // the conversation's version (real 163)
  [/Zzann's/, "place", "Kawa Ramen", "Zzann"], // the voice note's version (real 156)
  [/Acts of Faith/, "album", "Acts of Faith", "Zzmarcus"],
  [/Little Dark Age/, "song", "A Little Dark Age", "Zzdana"],
  [/Watchables/, "podcast", "The Watchables", "Zzsam"],
  [/Shogun/, "film_tv", "Shogun", "Zzlena"],
];
const find = (text: string) => ITEMS.find(([re]) => re.test(text));

describe.skipIf(!process.env.TEST_DATABASE_URL)("one earmark per moment across voice notes and a conversation (real Neon)", () => {
  const realFetch = globalThis.fetch;
  const outside: string[] = [];
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
    await sql`delete from recommendations where bee_conversation_id in (${CONV_A}, ${CONV_B}) or bee_journal_id like ${JID + "%"}`;
    await sql`delete from recommenders r where first_name_key = any(${PEOPLE}) and not exists (select 1 from recommendations x where x.recommender_id = r.id)`;
    await sql`delete from processed_journals where bee_journal_id like ${JID + "%"}`;
    await sql`delete from processed_conversations where bee_conversation_id in (${CONV_A}, ${CONV_B})`;
  });

  const bee = (base: number) => ({
    getConversation: async (id: number) => ({
      conversation: {
        id, state: "COMPLETED", start_time: base - 1_800_000, end_time: base + 1_800_000, summary: null, short_summary: null,
        transcriptions: [{
          realtime: false,
          utterances: CONVERSATION.map(([s, text], i) => ({ id: 201 + i, text, speaker: i % 2 ? "Unknown" : "Tarik", spoken_at: base + s * 1000 })),
        }],
      },
    }),
  }) as unknown as BeeClient;

  const deps = (base: number): Partial<PipelineDeps> => ({
    bee: bee(base),
    now: () => new Date(base + 3_600_000),
    triage: async (text: string) => {
      const hit = find(text);
      return hit ? tri({ recType: hit[1] }) : tri({ kind: "neither" });
    },
    extractRecommendation: async ({ text }) => {
      const hit = find(text);
      return { canonicalName: hit?.[2] ?? "Nothing", creator: null, recommenderName: hit?.[3] ?? null, excerpt: text.split(/\s+/).slice(0, 12).join(" ") };
    },
    extractIdea: async () => ({ title: "unused", excerpt: "unused" }),
    compost: { embedText: async () => Array.from({ length: 1536 }, (_, j) => (j === 1499 ? 1 : 0)), chooseCluster: async () => ({ key: null }), writeTimelineNote: async () => "stub" },
  });

  const runVoiceNotes = async (base: number, suffix: string) => {
    const { processJournal } = await import("../../agent/lib/pipeline/process-journal");
    for (const [name, s, text] of VOICE_NOTES) {
      await processJournal({ id: `${JID}-${suffix}-${name}`, text, createdAt: new Date(base + s * 1000) }, deps(base));
    }
  };

  const recsOf = async (where: { conv?: number; journalPrefix?: string }) => {
    const { db } = await import("../../agent/lib/db");
    const rows = where.conv !== undefined
      ? await db()`select r.id, r.canonical_name, r.source, r.deliberate_key, rc.first_name from recommendations r
                   left join recommenders rc on rc.id = r.recommender_id where r.bee_conversation_id = ${where.conv} order by r.said_at`
      : await db()`select r.id, r.canonical_name, r.source, r.deliberate_key, rc.first_name from recommendations r
                   left join recommenders rc on rc.id = r.recommender_id where r.bee_journal_id like ${where.journalPrefix + "%"} order by r.said_at`;
    return rows;
  };

  it("voice notes first, then the conversation: only Dana's song and Sam's podcast are saved from the conversation", async () => {
    const base = baseFor(0);
    await runVoiceNotes(base, "a");
    expect((await recsOf({ journalPrefix: `${JID}-a-` })).map((r) => r.canonical_name)).toEqual(["Kawa Ramen", "Acts of Faith", "Shogun"]);

    const { processConversation } = await import("../../agent/lib/pipeline/process-conversation");
    const r = await processConversation(CONV_A, deps(base));
    expect(r).toMatchObject({ skipped: false, incomplete: false, failed: 0, recs: 2 });
    const rows = await recsOf({ conv: CONV_A });
    expect(rows.map((x) => [x.canonical_name, x.first_name, x.source])).toEqual([
      ["A Little Dark Age", "Zzdana", "voice"],
      ["The Watchables", "Zzsam", "voice"],
    ]);
  }, SLOW);

  it("conversation first, then the voice notes: the voice notes that repeat it are skipped and point at its rec", async () => {
    const base = baseFor(1);
    const { processConversation } = await import("../../agent/lib/pipeline/process-conversation");
    const r = await processConversation(CONV_B, deps(base));
    expect(r).toMatchObject({ skipped: false, recs: 5 });
    const rows = await recsOf({ conv: CONV_B });
    expect(rows.map((x) => [x.canonical_name, x.source, x.deliberate_key])).toEqual([
      ["Kawa Ramen (ramen spot on Brady Street)", "voice", "u203"], // the split trigger is caught: deliberate, not ambient
      ["Acts of Faith", "voice", "u206"],
      ["A Little Dark Age", "voice", "u208"],
      ["The Watchables", "voice", "u210"],
      ["Shogun", "voice", "u211"],
    ]);

    await runVoiceNotes(base, "b");
    expect(await recsOf({ journalPrefix: `${JID}-b-` })).toEqual([]);
    const { db } = await import("../../agent/lib/db");
    const claims = await db()`select bee_journal_id, item_type, item_id, done from processed_journals where bee_journal_id like ${JID + "-b-%"} order by bee_journal_id`;
    const byName = Object.fromEntries(rows.map((x) => [x.canonical_name as string, String(x.id)]));
    expect(claims.map((c) => [String(c.bee_journal_id).split("-").at(-1), c.item_type, c.item_id === null ? null : String(c.item_id), c.done])).toEqual([
      ["cut1", "none", null, true],
      ["cut2", "none", null, true],
      ["kawa", "rec", byName["Kawa Ramen (ramen spot on Brady Street)"], true],
      ["lena", "rec", byName["Shogun"], true],
      ["marcus", "rec", byName["Acts of Faith"], true],
    ]);
  }, SLOW);
});
