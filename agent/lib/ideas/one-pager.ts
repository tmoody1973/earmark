import { experimental_decide, generateText } from "ai";
import { createBeeClient, type BeeClient, type KeywordSearchResult, type NeuralSearchResult } from "../bee/client";
import { db } from "../db";
import { getEnv } from "../env";
import { clampExcerpt, wordCount } from "../pipeline/excerpt";
import { claimDraftableClusters, getClusterForDraft, MAX_DRAFT_ATTEMPTS, releaseDraftClaim, saveDraft } from "../store/ideas";
import { MATCH_MIN } from "./choose-cluster";
import { ONE_PAGER_PROMPT } from "./one-pager-prompt";
import { formatTimelineDate } from "./timeline";

// The one-page draft written when an idea blooms (M2-T7). Runs AFTER the bloom committed, never inside the claim
// transaction: the ingest path kicks it right after a save that bloomed, and the 10-minute bee-changes schedule tail
// picks up anything missed or failed. Jev only chooses (format, context relevance); the WRITE model only writes.

// Every step fails inside the 60 s ingress route (live triage ~5 s before it): Bee searches run in parallel with the
// format choice, then the context gate, then the write: 6 + 10 + 30 = 46 s worst case.
export const BEE_SEARCH_TIMEOUT_MS = 6_000;
export const JEV_TIMEOUT_MS = 10_000;
export const WRITE_TIMEOUT_MS = 30_000;

export type DraftFormat = "newsletter_pitch" | "radio_segment" | "product_brief";

const FORMAT_INSTRUCTIONS =
  "What do the mentions in `mentions` propose to make for the idea in `idea`? Choose by the thing that would actually " +
  "be made (its medium), not by what it is about.";

// Exact per-option criteria with boundary cases (Jev rules): the medium decides, the subject never does.
export const DRAFT_FORMAT_CRITERIA: Record<DraftFormat, string> = {
  newsletter_pitch:
    "The mentions propose something to write for readers: a newsletter issue, column, essay, article, blog post or " +
    "written series, or an argument, trend or explainer with no medium stated. Choose this even when the topic is " +
    "radio, music or technology. Do not choose this when any mention says it should be heard (on air, a segment, a " +
    "show, a podcast) or that something should be built or set up for people to use.",
  radio_segment:
    "The mentions propose something to be heard: a radio segment, show, episode, podcast, interview, on-air feature, " +
    "playlist or listener call-in. Choose this when any mention says it should air or be heard, even if a newsletter is " +
    "also mentioned. Do not choose this when radio is only the subject, for example software, a database or a CRM for " +
    "radio stations: that is something to build.",
  product_brief:
    "The mentions propose something to build, set up or change for people to use: an app, tool, feature, website, " +
    "database, CRM, workflow, service or product, including one made for a radio station or a newsletter team. Choose " +
    "this even when the topic is radio or writing. Do not choose this when the thing to make is a piece of writing or " +
    "a piece of audio.",
};

// Context gate (privacy): a Bee search result reaches the writer only when Jev judges it about THIS idea. The excluding
// option is listed first: Jev leans toward the first option, so a close call leaves the context out.
export const CONTEXT_MATCH_MIN = MATCH_MIN; // same bar as joining a cluster (0.6)
export const RELATED_CRITERIA = {
  different_idea:
    "The note only shares a topic word, a kind of tool, a person or a place with the idea; e.g. a CRM for real-estate " +
    "agents is not a CRM for public radio stations, and a podcast about cooking is not a podcast about music. Choose " +
    "this also when the note is about a different subject, a different deliverable or a different audience, or when " +
    "the idea is only mentioned in passing.",
  same_idea:
    "The note discusses the same core proposal as the idea (same subject and same deliverable or audience), even in " +
    "different words, in a different format or with extra details such as names or places.",
} as const;
export const FACT_CRITERIA = {
  not_relevant:
    "The fact only shares a topic word with the idea, or is about a part of the author's life that does not bear on " +
    "making it; e.g. 'sells houses on the side' is not relevant to a CRM for public radio stations just because a CRM " +
    "could serve both, and a favourite food or a family detail is never relevant. Do not choose relevant for these.",
  relevant:
    "The fact tells something about the author's own work, role, skills, audience or existing projects that bears " +
    "directly on making this idea; e.g. 'works at a public radio station' for a CRM for public radio stations, or " +
    "'writes a newsletter' for a newsletter idea.",
} as const;

const errName = (err: unknown) => (err instanceof Error ? err.name : "unknown");
const unquote = (s: string) => s.replaceAll('"', "'"); // excerpts are wrapped in double quotes below
const bullets = (items: string[]) => items.map((e) => `- ${e}`).join("\n");

export async function chooseDraftFormat(
  idea: { title: string; excerpts: string[] },
  opts: { model?: string; decideImpl?: typeof experimental_decide } = {},
): Promise<{ format: DraftFormat; probability: number }> {
  const decide = opts.decideImpl ?? experimental_decide;
  const result = await decide({
    model: opts.model ?? getEnv().TRIAGE_MODEL,
    state: { idea: idea.title, mentions: bullets(idea.excerpts) },
    questions: { format: { type: "choice", instructions: FORMAT_INSTRUCTIONS, criteria: DRAFT_FORMAT_CRITERIA } },
    abortSignal: AbortSignal.timeout(JEV_TIMEOUT_MS),
  });
  const answer = result.answers.format;
  const format = String(answer.choice) as DraftFormat;
  if (!Object.hasOwn(DRAFT_FORMAT_CRITERIA, format)) throw new Error("unexpected draft format");
  return { format, probability: answer.probabilities?.[format] ?? 0 };
}

export interface GatedContext { related: string[]; facts: string[]; probabilities: { related: number[]; facts: number[] } }

// One Jev call: a Choice per related note (rel_<i>) and per fact (fact_<i>), each judged on its own against the idea.
// Kept only when P(same_idea | relevant) ≥ CONTEXT_MATCH_MIN; a missing distribution counts as 0.
export async function gateContext(
  input: { title: string; excerpts: string[]; related: string[]; facts: string[] },
  opts: { model?: string; decideImpl?: typeof experimental_decide } = {},
): Promise<GatedContext> {
  if (input.related.length === 0 && input.facts.length === 0) return { related: [], facts: [], probabilities: { related: [], facts: [] } };
  const decide = opts.decideImpl ?? experimental_decide;
  const state: Record<string, string> = { idea: input.title, mentions: bullets(input.excerpts) };
  const questions: Record<string, { type: "choice"; instructions: string; criteria: Record<string, string> }> = {};
  input.related.forEach((note, i) => {
    state[`rel_${i}`] = note;
    questions[`rel_${i}`] = {
      type: "choice", criteria: RELATED_CRITERIA,
      instructions: `Is the conversation note in \`rel_${i}\` about the same idea as \`idea\` (as said in \`mentions\`)?`,
    };
  });
  input.facts.forEach((fact, i) => {
    state[`fact_${i}`] = fact;
    questions[`fact_${i}`] = {
      type: "choice", criteria: FACT_CRITERIA,
      instructions: `Is the fact about the author in \`fact_${i}\` relevant to making the idea in \`idea\` (as said in \`mentions\`)?`,
    };
  });
  const result = await decide({
    model: opts.model ?? getEnv().TRIAGE_MODEL, state, questions, abortSignal: AbortSignal.timeout(JEV_TIMEOUT_MS),
  });
  const answers = result.answers as Record<string, { probabilities?: Record<string, number> } | undefined>;
  const p = (key: string, keep: string) => answers[key]?.probabilities?.[keep] ?? 0;
  const pRel = input.related.map((_, i) => p(`rel_${i}`, "same_idea"));
  const pFact = input.facts.map((_, i) => p(`fact_${i}`, "relevant"));
  return {
    related: input.related.filter((_, i) => pRel[i]! >= CONTEXT_MATCH_MIN),
    facts: input.facts.filter((_, i) => pFact[i]! >= CONTEXT_MATCH_MIN),
    probabilities: { related: pRel, facts: pFact },
  };
}

// Summaries only (never transcript text) go into the prompt, and the prompt forbids quoting them.
export function relatedFromNeural(results: NeuralSearchResult["results"], max = 5): string[] {
  return results
    .map((r) => r.short_summary?.trim() || r.detailed_summary?.trim().slice(0, 400) || "")
    .filter(Boolean)
    .slice(0, max);
}

export function factsFromKeyword(results: KeywordSearchResult["results"]): string[] {
  return results.filter((r) => r.type === "fact").map((r) => r.summary?.trim() || r.snippet?.trim() || "").filter(Boolean);
}

const norm = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[^\p{L}\p{N}']+/gu, " ").trim();

// The quote rules, in code. Any quoted span is cut to maxWords. Curly quotes pair strictly (“…”); straight quotes are
// touched only on a line where they balance (a lone `5" screen` never pairs with a later quote and cuts prose).
// With `excerpts`: a quote that is not (after normalising case and punctuation) part of an excerpt loses its quote
// marks, so the draft never presents invented words as said. Lines under "## Headline options" are exempt.
export function enforceQuoteLimit(text: string, maxWords = 25, excerpts?: string[]): string {
  const real = excerpts?.map(norm);
  let headlines = false;
  return text.split("\n").map((line) => {
    if (line.startsWith("## ")) headlines = /^## Headline options\b/i.test(line);
    const fix = (open: string, body: string, close: string) => {
      const clamped = clampExcerpt(body, maxWords);
      if (!real || headlines) return `${open}${clamped}${close}`;
      const n = norm(clamped);
      return n && real.some((r) => r.includes(n)) ? `${open}${clamped}${close}` : clamped;
    };
    let out = line.replace(/“([^“”\n]+)”/g, (_m, body: string) => fix("“", body, "”"));
    if ((out.match(/"/g) ?? []).length % 2 === 0) out = out.replace(/"([^"\n]+)"/g, (_m, body: string) => fix('"', body, '"'));
    return out;
  }).join("\n");
}

export function mentionDatesLine(dates: Date[]): string {
  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
  return `Mentioned ${sorted.length} times: ${sorted.map((d) => formatTimelineDate(d)).join(" · ")}`;
}

export const DRAFT_MIN_WORDS = 300;
export const DRAFT_MAX_WORDS = 700;
export class DraftLengthError extends Error {
  override name = "DraftLengthError";
  constructor(readonly words: number) {
    super(`draft has ${words} words, outside ${DRAFT_MIN_WORDS}–${DRAFT_MAX_WORDS}`);
  }
}

export interface OnePagerInput {
  title: string; format: DraftFormat; timelineLines: string[]; excerpts: string[]; related: string[]; facts: string[];
  research?: string; // the idea's done research brief (decision 057): web facts with numbered sources
}

const list = (label: string, items: string[]) => (items.length ? `${label}:\n${bullets(items)}` : `${label}: none.`);

export async function writeOnePager(input: OnePagerInput, opts: { generateImpl?: typeof generateText } = {}): Promise<string> {
  const run = opts.generateImpl ?? generateText;
  const { text } = await run({
    model: getEnv().WRITE_MODEL,
    instructions: ONE_PAGER_PROMPT,
    abortSignal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
    prompt: [
      `Format: ${input.format}`,
      `Idea: ${input.title}`,
      list("Timeline (oldest first)", input.timelineLines),
      list("Mention excerpts (oldest first; the only text you may quote)", input.excerpts),
      list("Related conversation notes (paraphrase only)", input.related),
      list("Facts about the author (paraphrase only)", input.facts),
      ...(input.research ? [`Research brief (from the web; a fact used from it names its source's site in parentheses; never quote it as said):\n${input.research}`] : []),
    ].join("\n\n"),
  });
  const body = text.trim();
  const n = wordCount(body);
  if (n < DRAFT_MIN_WORDS || n > DRAFT_MAX_WORDS) throw new DraftLengthError(n);
  return body;
}

export interface OnePagerDeps {
  bee: Pick<BeeClient, "neuralSearch" | "keywordSearch">;
  gateContext: typeof gateContext;
  chooseDraftFormat: typeof chooseDraftFormat;
  writeOnePager: typeof writeOnePager;
}
export interface DraftResult { clusterId: number; format: DraftFormat; probability: number; draft: string }

// ponytail: a few per run, one at a time; each is ≤ 46 s by the timeouts above.
export const DRAFTS_PER_RUN = 3;

const fmt = (ps: number[]) => ps.map((p) => p.toFixed(2)).join(",") || "-";

// Bee search, then the relevance gate. Fails closed: any failure yields no context (ids + error names logged).
async function gatedContext(clusterId: number, title: string, excerpts: string[], d: OnePagerDeps): Promise<{ related: string[]; facts: string[] }> {
  const [related, facts] = await Promise.all([
    d.bee.neuralSearch(title, { limit: 5 }, AbortSignal.timeout(BEE_SEARCH_TIMEOUT_MS)).then((r) => relatedFromNeural(r.results)).catch((err: unknown) => {
      console.error(`[draft] cluster=${clusterId} neural search failed error=${errName(err)}`);
      return [] as string[];
    }),
    d.bee.keywordSearch(title, { filter: "facts", limit: 5 }, AbortSignal.timeout(BEE_SEARCH_TIMEOUT_MS)).then((r) => factsFromKeyword(r.results)).catch((err: unknown) => {
      console.error(`[draft] cluster=${clusterId} fact search failed error=${errName(err)}`);
      return [] as string[];
    }),
  ]);
  if (related.length === 0 && facts.length === 0) return { related, facts };
  try {
    const g = await d.gateContext({ title, excerpts, related, facts });
    console.log(`[draft] cluster=${clusterId} context related=${g.related.length}/${related.length} p_rel=${fmt(g.probabilities.related)} ` +
      `facts=${g.facts.length}/${facts.length} p_fact=${fmt(g.probabilities.facts)}`);
    return g;
  } catch (err) {
    console.error(`[draft] cluster=${clusterId} context gate failed error=${errName(err)}; drafting without related notes or facts`);
    return { related: [], facts: [] };
  }
}

async function draftClaimed(clusterId: number, claim: string, d: OnePagerDeps): Promise<DraftResult | null> {
  const c = await getClusterForDraft(clusterId);
  if (!c) return null;
  // Both are stored in processing order: sort by date here.
  const mentions = [...c.mentions].sort((a, b) => a.spokenAt.getTime() - b.spokenAt.getTime());
  const timelineLines = [...c.timeline].sort((a, b) => a.date.localeCompare(b.date)).map((t) => t.line);
  const excerpts = mentions.map((m) => unquote(clampExcerpt(m.excerpt)));

  // The format choice does not need Bee context, so it runs alongside search + gate.
  const [{ related, facts }, { format, probability }] = await Promise.all([
    gatedContext(clusterId, c.title, excerpts, d),
    d.chooseDraftFormat({ title: c.title, excerpts }),
  ]);
  const body = await d.writeOnePager({
    title: c.title, format, timelineLines, related, facts,
    excerpts: mentions.map((m, i) => `${formatTimelineDate(m.spokenAt)}: "${excerpts[i]}"`),
    ...(c.research ? { research: c.research } : {}),
  });
  const draft = `${mentionDatesLine(mentions.map((m) => m.spokenAt))}\n\n${enforceQuoteLimit(body, 25, excerpts)}`;
  const [saved] = await db().transaction((txn) => [saveDraft(txn, clusterId, draft, format, claim)]);
  if (!saved?.length) {
    console.log(`[draft] cluster=${clusterId} no longer ready or its claim was cleared; draft discarded`);
    return null;
  }
  console.log(`[draft] cluster=${clusterId} drafted format=${format} p=${probability.toFixed(2)} words=${wordCount(draft)}`);
  return { clusterId, format, probability, draft };
}

// Claim bloomed clusters without a draft (only `clusterIds` if given), draft each, save draft + stage 'drafted' in one
// statement. Idempotent: drafted, not-ready and claimed-elsewhere clusters are never claimed. A failed draft gives its
// claim back (the cluster stays bloomed without a draft) for a later run, up to MAX_DRAFT_ATTEMPTS.
export async function draftBlooms(
  opts: { clusterIds?: number[]; limit?: number; deps?: Partial<OnePagerDeps> } = {},
): Promise<DraftResult[]> {
  const claims = await claimDraftableClusters({ clusterIds: opts.clusterIds, limit: opts.limit ?? DRAFTS_PER_RUN });
  if (claims.length === 0) return [];
  const d: OnePagerDeps = { gateContext, chooseDraftFormat, writeOnePager, ...opts.deps, bee: opts.deps?.bee ?? createBeeClient() };
  const out: DraftResult[] = [];
  for (const { id, attempts, claim } of claims) {
    try {
      const r = await draftClaimed(id, claim, d);
      if (r) out.push(r);
    } catch (err) {
      console.error(`[draft] cluster=${id} failed error=${errName(err)}; stays bloomed without a draft`);
      if (attempts >= MAX_DRAFT_ATTEMPTS) {
        console.error(`[draft] cluster=${id} gave up after ${attempts} attempts error=${errName(err)}; retry: scripts/draft-one-pager.ts ${id} --reset`);
      }
      await releaseDraftClaim(id).catch((e: unknown) => console.error(`[draft] cluster=${id} release failed error=${errName(e)}`));
    }
  }
  return out;
}

export async function draftOnePagerForCluster(clusterId: number, deps: Partial<OnePagerDeps> = {}): Promise<DraftResult | null> {
  return (await draftBlooms({ clusterIds: [clusterId], limit: 1, deps }))[0] ?? null;
}
