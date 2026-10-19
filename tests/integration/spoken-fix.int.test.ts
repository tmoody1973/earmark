import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool, type PoolClient } from "@neondatabase/serverless";
import type { BeeClient } from "../../agent/lib/bee/client";
import type { ExternalDeps } from "../../agent/lib/privacy/forget";
import type { PipelineDeps } from "../../agent/lib/pipeline/process-conversation";
import type { RecentTip } from "../../agent/lib/recs/spoken-fix";
import type { TriageResult } from "../../agent/lib/types";

// "Fix this tip", piece 3 (decision 049) on the Neon `test` branch (TEST_DATABASE_URL, never production); skipped when
// absent. The models are fakes (triage, the correction extractor, Jev's pick) and a fetch guard proves no other network
// call. The recent-tips read and the candidate ranking are real. Invented sentences only.
const RUN = Date.now() % 1_000_000_000;
const CONV = 9_600_000_000 + RUN * 10;
const JOURNAL = `it-fix-${RUN}`;
const WRONG = `Velvet Moth ${RUN}`; // the tip as Bee misheard it
const RIGHT = `Velvet Mouth ${RUN}`;
const SAID = `Earmark, that ${WRONG} tip should be ${RIGHT}, the band.`;
const BODY = `${WRONG} tip should be ${RIGHT}, the band`; // what the trigger leaves

const tri = (over: Partial<TriageResult>): TriageResult => ({
  kind: "rec_to_user", kindProbability: 0.95, recType: "artist", recTypeProbability: 0.9, jokingProbability: 0.02,
  broadcastProbability: 0.01, model: "fake", providerMetadata: null, ...over,
});

describe.skipIf(!process.env.TEST_DATABASE_URL)("a fix said out loud, on the Neon test branch (decision 049)", () => {
  const realFetch = globalThis.fetch;
  const outside: string[] = [];
  let pool: Pool;
  let c: PoolClient;
  const ids: number[] = [];
  const picked: number[][] = [];
  const row = async (text: string, values: unknown[]) => (await c.query(text, values)).rows;

  const addTip = async (name = WRONG, status = "new") => {
    const { rows } = await c.query(
      `insert into recommendations (type, raw_text, canonical_name, excerpt, said_at, source, status, confidence, enrichment_status)
       values ('album', 'it spoken fix', $1, 'it spoken fix', now(), 'ambient', $2, 0.9, 'matched') returning id`, [name, status]);
    const id = Number(rows[0].id);
    ids.push(id);
    return id;
  };

  const bee = () => ({
    getConversation: async () => ({
      conversation: {
        id: CONV, state: "COMPLETED", start_time: Date.parse("2026-10-18T18:20:00Z"), end_time: Date.parse("2026-10-18T18:30:00Z"),
        summary: null, short_summary: null,
        transcriptions: [{ realtime: false, utterances: [SAID, `${RIGHT} is so good`, "you have to hear them live", "anyway"]
          .map((text, i) => ({ id: 500 + i, text, speaker: "Unknown", spoken_at: Date.parse("2026-10-18T18:23:00Z") + i * 1000 })) }],
      },
    }),
  }) as unknown as BeeClient;

  // The pick sees the real candidates (closest recent tips) and chooses this file's misheard tip if it is among them.
  const deps = (): Partial<PipelineDeps> => ({
    bee: bee(),
    now: () => new Date("2026-10-18T18:40:00Z"),
    triage: async (text: string) => (text.includes("should be") ? tri({ correctionProbability: 0.95 }) : tri({})),
    extractRecommendation: async () => ({ canonicalName: RIGHT, creator: null, recommenderName: null, excerpt: `${RIGHT} is so good` }),
    extractIdea: async () => { throw new Error("no idea here"); },
    fix: {
      extract: async () => ({ heardAs: WRONG, name: RIGHT, creator: null, type: "artist" }),
      pick: async (_s: unknown, cands: readonly RecentTip[]) => {
        picked.push(cands.map((t) => t.id));
        return cands.find((t) => t.canonical_name === WRONG) ?? null;
      },
    },
  });

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    c = await pool.connect();
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const host = new URL(String(input instanceof Request ? input.url : input)).host;
      if (!/neon\.tech/.test(host)) {
        outside.push(host);
        throw new Error(`unexpected network call to ${host}`);
      }
      return realFetch(input, init);
    }) as typeof fetch;
  });
  afterEach(() => expect(outside).toEqual([]));
  afterAll(async () => {
    globalThis.fetch = realFetch;
    if (!c) return;
    await c.query(`delete from recommendations where id = any($1::bigint[]) or bee_conversation_id = $2`, [ids, CONV]);
    await c.query(`delete from processed_conversations where bee_conversation_id = $1`, [CONV]);
    await c.query(`delete from processed_journals where bee_journal_id = $1`, [JOURNAL]);
    c.release();
    await pool.end();
  });

  let tip = 0;
  let proposal = 0;

  it("a conversation with the owner's correction stores one proposal for the right tip, and no new tip", async () => {
    tip = await addTip();
    const { processConversation } = await import("../../agent/lib/pipeline/process-conversation");
    const r = await processConversation(CONV, deps());
    expect(r).toMatchObject({ skipped: false, incomplete: false, failed: 0, recs: 0 });
    expect(picked[0]).toContain(tip);
    expect(await row(`select count(*)::int as n from recommendations where bee_conversation_id = $1`, [CONV])).toEqual([{ n: 0 }]);
    const ps = await row(`select id, name, creator, type, status, bee_conversation_id, bee_journal_id from tip_fix_proposals where rec_id = $1`, [tip]);
    expect(ps).toEqual([expect.objectContaining({ name: RIGHT, creator: null, type: "artist", status: "pending", bee_journal_id: null })]);
    expect(Number(ps[0]!.bee_conversation_id)).toBe(CONV);
    proposal = Number(ps[0]!.id);
    expect((await row(`select canonical_name from recommendations where id = $1`, [tip]))[0]!.canonical_name).toBe(WRONG); // never applied by itself
  });

  it("the same correction as a voice note does not wait twice", async () => {
    const { processJournal } = await import("../../agent/lib/pipeline/process-journal");
    expect(await processJournal({ id: JOURNAL, text: `Earmark that, ${BODY}`, createdAt: new Date() }, deps())).toMatchObject({ created: null });
    expect(await row(`select count(*)::int as n from tip_fix_proposals where rec_id = $1`, [tip])).toEqual([{ n: 1 }]);
    expect(await row(`select item_type, done from processed_journals where bee_journal_id = $1`, [JOURNAL])).toEqual([{ item_type: "none", done: true }]);
  });

  it("Home lists it with the tip's words now and after the fix", async () => {
    const { pendingTipFixes } = await import("../../agent/lib/recs/spoken-fix");
    expect((await pendingTipFixes(500)).find((f) => f.id === proposal)).toEqual({ id: proposal, recId: tip, type: "album", from: WRONG, to: RIGHT, toType: "artist" });
  });

  it("Apply changes the tip's words and sends it back for a lookup; a second Apply does nothing", async () => {
    const { applyTipFixProposal } = await import("../../agent/lib/recs/spoken-fix");
    expect(await applyTipFixProposal(proposal)).toEqual({ changed: true });
    expect(await row(`select canonical_name, type, enrichment_status from recommendations where id = $1`, [tip]))
      .toEqual([{ canonical_name: RIGHT, type: "artist", enrichment_status: "pending" }]);
    expect(await row(`select status from tip_fix_proposals where id = $1`, [proposal])).toEqual([{ status: "applied" }]);
    expect(await applyTipFixProposal(proposal)).toEqual({ changed: false });
  });

  it("Ignore changes nothing on the tip", async () => {
    const { applyTipFixProposal, ignoreTipFixProposal } = await import("../../agent/lib/recs/spoken-fix");
    const other = await addTip(`Glass Harbour ${RUN}`);
    const { rows } = await c.query(`insert into tip_fix_proposals (rec_id, name) values ($1, $2) returning id`, [other, `Glass Harbor ${RUN}`]);
    const pid = Number(rows[0].id);
    expect(await ignoreTipFixProposal(pid)).toEqual({ changed: true });
    expect(await ignoreTipFixProposal(pid)).toEqual({ changed: false });
    expect(await applyTipFixProposal(pid)).toEqual({ changed: false });
    expect(await row(`select canonical_name, enrichment_status from recommendations where id = $1`, [other]))
      .toEqual([{ canonical_name: `Glass Harbour ${RUN}`, enrichment_status: "matched" }]);
  });

  it("a tip cleared before Apply: refused, nothing changed, and Home no longer shows it", async () => {
    const { applyTipFixProposal, pendingTipFixes } = await import("../../agent/lib/recs/spoken-fix");
    const cleared = await addTip(`Night Gardn ${RUN}`);
    const { rows } = await c.query(`insert into tip_fix_proposals (rec_id, name) values ($1, $2) returning id`, [cleared, `Night Garden ${RUN}`]);
    const pid = Number(rows[0].id);
    await c.query(`update recommendations set status = 'dismissed' where id = $1`, [cleared]);
    expect(await applyTipFixProposal(pid)).toEqual({ changed: false, refused: true });
    expect(await row(`select canonical_name from recommendations where id = $1`, [cleared])).toEqual([{ canonical_name: `Night Gardn ${RUN}` }]);
    expect((await pendingTipFixes(500)).some((f) => f.id === pid)).toBe(false);
  });

  it("forgetting the tip deletes its proposals", async () => {
    const { forget } = await import("../../agent/lib/privacy/forget");
    const deps = { deleteTodo: vi.fn(async () => {}), deleteFact: vi.fn(async () => {}), trashNotionPage: vi.fn(async () => {}), deleteBlob: vi.fn(async () => {}) };
    const dry = await forget(c, { type: "rec", id: tip }, { yes: false, deps: deps as ExternalDeps });
    expect(dry.plan.deletes).toMatchObject({ recommendations: 1, tip_fix_proposals: 1 });
    await forget(c, { type: "rec", id: tip }, { yes: true, deps: deps as ExternalDeps });
    expect(await row(`select count(*)::int as n from tip_fix_proposals where rec_id = $1`, [tip])).toEqual([{ n: 0 }]);
  });
});
