import { experimental_decide, generateText } from "ai";
import { createBeeClient, type BeeClient, type KeywordSearchResult, type NeuralSearchResult } from "../bee/client";
import { db } from "../db";
import { getEnv } from "../env";
import { clampExcerpt, wordCount } from "../pipeline/excerpt";
import { claimDraftableClusters, getClusterForDraft, releaseDraftClaim, saveDraft } from "../store/ideas";
import { ONE_PAGER_PROMPT } from "./one-pager-prompt";
import { formatTimelineDate } from "./timeline";

// The one-page draft written when an idea blooms (M2-T7). Runs AFTER the bloom committed, never inside the claim
// transaction: the ingest path kicks it right after a save that bloomed, and the 10-minute bee-changes schedule tail
// picks up anything missed or failed. Jev only chooses the format; the WRITE model only writes; code does the rest.

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

const errName = (err: unknown) => (err instanceof Error ? err.name : "unknown");
const unquote = (s: string) => s.replaceAll('"', "'"); // excerpts are wrapped in double quotes below

export async function chooseDraftFormat(
  idea: { title: string; excerpts: string[] },
  opts: { model?: string; decideImpl?: typeof experimental_decide } = {},
): Promise<{ format: DraftFormat; probability: number }> {
  const decide = opts.decideImpl ?? experimental_decide;
  const result = await decide({
    model: opts.model ?? getEnv().TRIAGE_MODEL,
    state: { idea: idea.title, mentions: idea.excerpts.map((e) => `- ${e}`).join("\n") },
    questions: { format: { type: "choice", instructions: FORMAT_INSTRUCTIONS, criteria: DRAFT_FORMAT_CRITERIA } },
    abortSignal: AbortSignal.timeout(20_000),
  });
  const answer = result.answers.format;
  const format = String(answer.choice) as DraftFormat;
  if (!Object.hasOwn(DRAFT_FORMAT_CRITERIA, format)) throw new Error("unexpected draft format");
  return { format, probability: answer.probabilities?.[format] ?? 0 };
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

// The quote limit, in code: any quoted span (straight or curly, within one line) is cut to maxWords.
export function enforceQuoteLimit(text: string, maxWords = 25): string {
  return text.replace(/(["“])([^"”\n]+)(["”])/g, (_m, open: string, body: string, close: string) => `${open}${clampExcerpt(body, maxWords)}${close}`);
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
}

const list = (label: string, items: string[]) => (items.length ? `${label}:\n${items.map((l) => `- ${l}`).join("\n")}` : `${label}: none.`);

export async function writeOnePager(input: OnePagerInput, opts: { generateImpl?: typeof generateText } = {}): Promise<string> {
  const run = opts.generateImpl ?? generateText;
  const { text } = await run({
    model: getEnv().WRITE_MODEL,
    instructions: ONE_PAGER_PROMPT,
    abortSignal: AbortSignal.timeout(120_000),
    prompt: [
      `Format: ${input.format}`,
      `Idea: ${input.title}`,
      list("Timeline (oldest first)", input.timelineLines),
      list("Mention excerpts (oldest first; the only text you may quote)", input.excerpts),
      list("Related conversation notes (paraphrase only)", input.related),
      list("Facts about the author (paraphrase only)", input.facts),
    ].join("\n\n"),
  });
  const body = text.trim();
  const n = wordCount(body);
  if (n < DRAFT_MIN_WORDS || n > DRAFT_MAX_WORDS) throw new DraftLengthError(n);
  return body;
}

export interface OnePagerDeps {
  bee: Pick<BeeClient, "neuralSearch" | "keywordSearch">;
  chooseDraftFormat: typeof chooseDraftFormat;
  writeOnePager: typeof writeOnePager;
}
export interface DraftResult { clusterId: number; format: DraftFormat; draft: string }

// ponytail: a few per run, one at a time; each is ~3 s Bee search + a Jev call + one write.
export const DRAFTS_PER_RUN = 3;

async function draftClaimed(clusterId: number, d: OnePagerDeps): Promise<DraftResult | null> {
  const c = await getClusterForDraft(clusterId);
  if (!c) return null;
  // Both are stored in processing order: sort by date here.
  const mentions = [...c.mentions].sort((a, b) => a.spokenAt.getTime() - b.spokenAt.getTime());
  const timelineLines = [...c.timeline].sort((a, b) => a.date.localeCompare(b.date)).map((t) => t.line);
  const excerpts = mentions.map((m) => unquote(clampExcerpt(m.excerpt)));

  // Bee context, both searches at once; either failing still yields a draft.
  const [related, facts] = await Promise.all([
    d.bee.neuralSearch(c.title, { limit: 5 }).then((r) => relatedFromNeural(r.results)).catch((err: unknown) => {
      console.error(`[draft] cluster=${clusterId} neural search failed error=${errName(err)}`);
      return [] as string[];
    }),
    d.bee.keywordSearch(c.title, { filter: "facts", limit: 5 }).then((r) => factsFromKeyword(r.results)).catch((err: unknown) => {
      console.error(`[draft] cluster=${clusterId} fact search failed error=${errName(err)}`);
      return [] as string[];
    }),
  ]);

  const { format } = await d.chooseDraftFormat({ title: c.title, excerpts });
  const body = await d.writeOnePager({
    title: c.title, format, timelineLines, related, facts,
    excerpts: mentions.map((m, i) => `${formatTimelineDate(m.spokenAt)}: "${excerpts[i]}"`),
  });
  const draft = `${mentionDatesLine(mentions.map((m) => m.spokenAt))}\n\n${enforceQuoteLimit(body)}`;
  const [saved] = await db().transaction((txn) => [saveDraft(txn, clusterId, draft, format)]);
  if (!saved?.length) {
    console.log(`[draft] cluster=${clusterId} no longer ready; draft discarded`);
    return null;
  }
  console.log(`[draft] cluster=${clusterId} drafted format=${format} words=${wordCount(draft)}`);
  return { clusterId, format, draft };
}

// Claim bloomed clusters without a draft (only `clusterIds` if given), draft each, save draft + stage 'drafted' in one
// statement. Idempotent: drafted, not-ready and claimed-elsewhere clusters are never claimed. A failed draft gives its
// claim back (the cluster stays bloomed without a draft) for a later run, up to MAX_DRAFT_ATTEMPTS.
export async function draftBlooms(
  opts: { clusterIds?: number[]; limit?: number; deps?: Partial<OnePagerDeps> } = {},
): Promise<DraftResult[]> {
  const ids = await claimDraftableClusters({ clusterIds: opts.clusterIds, limit: opts.limit ?? DRAFTS_PER_RUN });
  if (ids.length === 0) return [];
  const d: OnePagerDeps = { chooseDraftFormat, writeOnePager, ...opts.deps, bee: opts.deps?.bee ?? createBeeClient() };
  const out: DraftResult[] = [];
  for (const id of ids) {
    try {
      const r = await draftClaimed(id, d);
      if (r) out.push(r);
    } catch (err) {
      console.error(`[draft] cluster=${id} failed error=${errName(err)}; stays bloomed without a draft, retried later`);
      await releaseDraftClaim(id).catch((e: unknown) => console.error(`[draft] cluster=${id} release failed error=${errName(e)}`));
    }
  }
  return out;
}

export async function draftOnePagerForCluster(clusterId: number, deps: Partial<OnePagerDeps> = {}): Promise<DraftResult | null> {
  return (await draftBlooms({ clusterIds: [clusterId], limit: 1, deps }))[0] ?? null;
}
