// "Fix this tip", piece 3 (decision 049): Tarik says a correction out loud ("Earmark, that Sun Raw tip should be Sun Ra,
// the musician"). The deliberate-earmark planner (pipeline/deliberate.ts) asks Jev, in its triage call, whether the
// earmark corrects a saved tip; if so, this finds which recent tip it means and stores a PROPOSED fix. A proposal is
// never applied on its own: Bee mishearing is the very problem, so Home asks first (Apply / Ignore), and Apply goes
// through applyTipFix like the other ways in. Stored: the tip id, the proposed name / creator / type and where it was
// said (conversation or voice-note id), never what was said. rec_id cascades: forgetting a tip deletes its proposals.
// Logs: none here; callers log ids and err.name only.
import { experimental_decide } from "ai";
import { db } from "../db";
import { NONE_FITS } from "../enrich/match";
import { getEnv } from "../env";
import { extractCorrection } from "../pipeline/extract";
import { ordered } from "../pipeline/triage";
import type { Txn } from "../store/conversations";
import type { RecType } from "../types";
import type { applyTipFix, TipFix, TipNow } from "./fix-tip";

// Loaded when used, not imported (as bee-todos.ts does): fix-tip → lane → garden → status → … would load the whole rec
// lane into the pipeline and Home's actions, and closes a cycle back through status-effects.
const fixTip = () => import("./fix-tip");
// Cleared tips, which no fix may touch: lane.ts SWEEP_SKIPS_STATUSES, spelled out so this file needn't load the lane.
// tests/lib/recs/spoken-fix.test.ts keeps the two equal.
export const CLEARED_STATUSES = ["dismissed", "composted", "overheard"] as const;

export const FIX_LOOKBACK_DAYS = 30;
export const MAX_TIP_CANDIDATES = 3; // as "Which one?" (MAX_CANDIDATES): Jev picks one of these, or none_fits
const TIP_ACCEPT = 0.8; // as MATCH_ACCEPT: below this Earmark can't tell which tip, and stores nothing
const RECENT_MAX = 500; // ponytail: a month of tips is a few dozen; this only bounds a runaway month
const JEV_TIMEOUT_MS = 10_000;

export type RecentTip = TipNow & { id: number };
export interface SpokenFix { recId: number; fix: TipFix & { name: string }; beeConversationId: number | null; beeJournalId: string | null }
export interface SpokenFixDeps { extract: typeof extractCorrection; recentTips: () => Promise<RecentTip[]>; pick: typeof pickTip }

// Letter trigrams, so a spelling Bee misheard again ("Velvet Mouth" for "Velvet Moth") still lands near.
const grams = (s: string): Set<string> => {
  const t = ` ${s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
  return new Set(Array.from({ length: Math.max(0, t.length - 2) }, (_, i) => t.slice(i, i + 3)));
};
const sharedCount = (a: Set<string>, b: Set<string>) => [...a].filter((g) => b.has(g)).length;

/**
 * The recent tips whose words are closest to what the owner called the tip, closest first. Pure. Scored against the
 * name, creator AND the why note: the misheard words may live only in the note (tip 150: "Jemetta Rose's new albums",
 * note "…a tribute to Sun Raw Records."). Containment (how much of what he said the tip holds), not Jaccard, so a
 * short phrase isn't drowned by a long name and note; Jaccard breaks ties, then the input's order (newest first).
 */
export function closestTips(heardAs: string, tips: readonly RecentTip[]): RecentTip[] {
  const said = grams(heardAs);
  return tips.map((t) => {
    const g = grams([t.canonical_name, t.creator, t.context_summary].filter(Boolean).join(" "));
    const shared = sharedCount(said, g);
    return { t, contained: shared / (said.size || 1), jaccard: shared / (said.size + g.size - shared || 1) };
  }).sort((a, b) => b.contained - a.contained || b.jaccard - a.jaccard).slice(0, MAX_TIP_CANDIDATES).map((x) => x.t);
}

/** Tips from the last FIX_LOOKBACK_DAYS that a fix may still change (not dismissed or composted). */
export async function recentTips(): Promise<RecentTip[]> {
  const rows = await db()`select id, type, canonical_name, creator, context_summary from recommendations
    where created_at >= now() - ${FIX_LOOKBACK_DAYS}::int * interval '1 day' and status <> all(${CLEARED_STATUSES}::text[])
    order by created_at desc limit ${RECENT_MAX}`;
  return rows.map((r) => ({ ...(r as TipNow), id: Number(r.id) }));
}

// Non-numeric keys: JS orders integer-like object keys numerically, which would undo the shuffle.
const keyOf = (i: number) => `t_${i}`;
const NOTE_CLIP = 120;
// The note is the why line already shown on the tip page (derived text, never the excerpt or transcript), clipped.
const clip = (s: string) => (s.length > NOTE_CLIP ? `${s.slice(0, NOTE_CLIP - 1).trimEnd()}…` : s);
const label = (t: RecentTip) => (`${t.canonical_name}${t.creator ? ` by ${t.creator}` : ""} (${t.type})` +
  (t.context_summary ? ` — note: ${clip(t.context_summary)}` : "")).replaceAll('"', "'");
// Jev reads literally: the condition plus the boundary case in the wording. Invented names only.
export const WHICH_TIP_INSTRUCTIONS =
  "The speaker says a tip Earmark saved is wrong; they call it `wrong_words` (their whole sentence is `what_was_said`). " +
  "Which listed tip do they mean? The words may match the tip's name, its creator or its note. If none of them, choose none_fits.";
const BOUNDARY =
  "Speech is often misheard, so a close spelling or sound counts ('Velvet Moth' for 'Velvet Mouth'); a tip that shares " +
  "only a common word ('the', 'new', 'album') does not.";

/** One choice question with an explicit abstain option, options shuffled (Jev leans toward the first option). */
export async function pickTip(
  input: { said: string; heardAs: string }, candidates: readonly RecentTip[],
  opts: { model?: string; decideImpl?: typeof experimental_decide; random?: () => number } = {},
): Promise<RecentTip | null> {
  if (candidates.length === 0) return null;
  const criteria: Record<string, string> = Object.fromEntries(
    candidates.map((t, i) => [keyOf(i), `The tip "${label(t)}" is the one the speaker calls wrong_words. ${BOUNDARY}`]),
  );
  criteria[NONE_FITS] = `No listed tip is the one the speaker calls wrong_words. ${BOUNDARY}`;
  const decide = opts.decideImpl ?? experimental_decide;
  const result = await decide({
    model: opts.model ?? getEnv().TRIAGE_MODEL,
    state: { wrong_words: input.heardAs, what_was_said: input.said },
    questions: { tip: { type: "choice", instructions: WHICH_TIP_INSTRUCTIONS, criteria: ordered(criteria, "shuffled", opts.random) } },
    abortSignal: AbortSignal.timeout(JEV_TIMEOUT_MS),
  });
  const answer = result.answers.tip;
  const choice = String(answer.choice);
  const probability = answer.probabilities?.[choice] ?? Number.NaN; // no distribution → never a pick
  const i = candidates.findIndex((_, k) => keyOf(k) === choice);
  return i >= 0 && probability >= TIP_ACCEPT ? candidates[i]! : null;
}

/**
 * The fix a spoken correction proposes, or null: Earmark can't tell which tip (no recent tip, or Jev abstains), or the
 * tip already says it. Only what the owner said goes in: a creator or type he didn't say stays as it is.
 */
export async function planSpokenFix(
  body: string, where: { beeConversationId: number | null; beeJournalId: string | null }, deps: Partial<SpokenFixDeps> = {},
): Promise<SpokenFix | null> {
  const d: SpokenFixDeps = { extract: extractCorrection, recentTips, pick: pickTip, ...deps };
  const c = await d.extract(body);
  const candidates = closestTips(c.heardAs, await d.recentTips());
  if (candidates.length === 0) return null;
  const tip = await d.pick({ said: body, heardAs: c.heardAs }, candidates);
  if (!tip) return null;
  const { planTipFix, TipFixSchema } = await fixTip();
  const fix = TipFixSchema.safeParse({ name: c.name, ...(c.creator ? { creator: c.creator } : {}), ...(c.type ? { type: c.type } : {}) });
  if (!fix.success || !fix.data.name || !planTipFix(tip, fix.data)) return null;
  return { recId: tip.id, fix: { ...fix.data, name: fix.data.name }, ...where };
}

/**
 * The proposal's insert, one statement in the save transaction. Writes nothing when the tip was cleared or forgotten
 * meanwhile, or the same fix already waits (a voice note Bee also heard inside a conversation).
 */
export function tipFixProposalQuery(txn: Txn, p: SpokenFix) {
  const { name, creator = null, type = null } = p.fix;
  return txn`insert into tip_fix_proposals (rec_id, name, creator, type, bee_conversation_id, bee_journal_id)
    select ${p.recId}::bigint, ${name}::text, ${creator}::text, ${type}::text, ${p.beeConversationId}::bigint, ${p.beeJournalId}::text
    where exists (select 1 from recommendations where id = ${p.recId}::bigint and status <> all(${CLEARED_STATUSES}::text[]))
      and not exists (select 1 from tip_fix_proposals where rec_id = ${p.recId}::bigint and status = 'pending'
        and name = ${name}::text and creator is not distinct from ${creator}::text and type is not distinct from ${type}::text)`;
}

type ProposalRow = { name: string; creator: string | null; type: RecType | null };
// A null creator or type was not said: it stays as the tip has it.
const fixOf = (p: ProposalRow): TipFix => ({ name: p.name, ...(p.creator !== null ? { creator: p.creator } : {}), ...(p.type ? { type: p.type } : {}) });
const words = (name: string, creator: string | null) => (creator ? `${name}, ${creator}` : name);

/** A Home card: the tip's name now (from), its words after the fix (to); toType only when the fix changes it. */
export interface TipFixCard { id: number; recId: number; type: RecType; from: string; to: string; toType: RecType | null }

/** Pending proposals for tips that are not cleared, newest first; one that the tip already matches is left out. */
export async function pendingTipFixes(limit = 10): Promise<TipFixCard[]> {
  const { planTipFix } = await fixTip();
  const rows = (await db()`
    select p.id, p.rec_id, p.name, p.creator, p.type, r.type as now_type, r.canonical_name, r.creator as now_creator, r.context_summary
    from tip_fix_proposals p join recommendations r on r.id = p.rec_id
    where p.status = 'pending' and r.status <> all(${CLEARED_STATUSES}::text[])
    order by p.created_at desc, p.id desc limit ${limit}`) as (ProposalRow & {
      id: number | string; rec_id: number | string; now_type: RecType; canonical_name: string; now_creator: string | null; context_summary: string | null;
    })[];
  return rows.flatMap((r) => {
    const plan = planTipFix({ type: r.now_type, canonical_name: r.canonical_name, creator: r.now_creator, context_summary: r.context_summary }, fixOf(r));
    return plan ? [{
      id: Number(r.id), recId: Number(r.rec_id), type: r.now_type, from: r.canonical_name,
      to: words(plan.name, plan.creator), toType: plan.type !== r.now_type ? plan.type : null,
    }] : [];
  });
}

const proposalId = (id: number) => {
  if (!Number.isSafeInteger(id) || id <= 0) throw new RangeError("invalid proposal id");
  return id;
};

/**
 * Apply: the fix goes through applyTipFix, once. changed false alone: nothing pending (already applied or ignored).
 * refused: the tip was cleared or changed since, nothing was fixed, and the proposal waits again (Home leaves it out
 * once it no longer applies). applyTipFix throwing also puts it back.
 */
export async function applyTipFixProposal(id: number, applyImpl?: typeof applyTipFix): Promise<{ changed: boolean; refused?: true }> {
  const pid = proposalId(id);
  const apply = applyImpl ?? (await fixTip()).applyTipFix;
  // Claim first, so two taps (or two tabs) never both apply it.
  const [p] = await db()`update tip_fix_proposals set status = 'applied', decided_at = now()
    where id = ${pid} and status = 'pending' returning rec_id, name, creator, type`;
  if (!p) return { changed: false };
  const reopen = () => db()`update tip_fix_proposals set status = 'pending', decided_at = null where id = ${pid} and status = 'applied'`;
  let r: Awaited<ReturnType<typeof applyTipFix>>;
  try {
    r = await apply(Number(p.rec_id), fixOf(p as ProposalRow));
  } catch (err) {
    await reopen();
    throw err;
  }
  if (r.changed) return { changed: true };
  await reopen();
  return { changed: false, refused: true };
}

/** Ignore: the proposal goes away; the tip is untouched. A no-op unless it is still pending. */
export async function ignoreTipFixProposal(id: number): Promise<{ changed: boolean }> {
  const pid = proposalId(id);
  const rows = await db()`update tip_fix_proposals set status = 'ignored', decided_at = now()
    where id = ${pid} and status = 'pending' returning id`;
  return { changed: rows.length > 0 };
}
