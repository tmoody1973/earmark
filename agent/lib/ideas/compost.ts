import { clampExcerpt } from "../pipeline/excerpt";
import type { ClusterPlan, SaveItem } from "../pipeline/save-item";
import {
  getClusterTimeline, hasMentionFromSameOccasion, MAX_CLUSTER_OPTIONS, nearestClusters, pinnedClustersNear, type OccasionSpan,
} from "../store/ideas";
import { chooseCluster, clusterKey, type ClusterOption } from "./choose-cluster";
import { embedText } from "./embed";
import { NOTE_AGAIN, NOTE_FIRST, writeTimelineNote } from "./timeline";

export interface CompostDeps {
  embedText: (text: string) => Promise<number[]>;
  chooseCluster: (idea: { title: string; excerpt: string }, options: ClusterOption[]) => Promise<{ key: string | null }>;
  writeTimelineNote: typeof writeTimelineNote;
}

// Every idea of one conversation or voice note failed to plan (Gateway or database down): an outage, not an answer.
// Callers release the claim (nothing is saved) so the next run retries, like SystemicTriageError.
export class CompostUnavailableError extends Error {
  override name = "CompostUnavailableError";
  constructor(readonly failed: number) {
    super(`idea compost unavailable: all ${failed} idea plan(s) failed`);
  }
}

const NEAREST = 5;

// A cluster this run already planned to create, offered to later ideas of the same run (key n_<i>).
type Pending = ClusterOption & { embedding: number[] };

function cosineDistance(a: readonly number[], b: readonly number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na === 0 || nb === 0 ? 1 : 1 - dot / Math.sqrt(na * nb);
}

type IdeaItem = Extract<SaveItem, { kind: "idea" }>;
type Decision = ClusterPlan | { action: "skip" };

// The pre-transaction half of the idea compost (the save is buildSaveQueries, inside the claim transaction).
// `items` must come from ONE occasion (one conversation or one voice note): a match on a cluster planned earlier in
// the same call is treated as a repeat from that occasion.
// For each idea, accepted or needs_review alike (Tarik: review-band ideas count), in order: embed it, offer Jev the
// nearest stored clusters (dismissed ones included: a mention joins them and they stay dismissed) plus the clusters
// this run is about to create, and attach the decision. An idea whose chosen cluster already has a mention from the
// same conversation or voice note (stored, or planned earlier in this run) is dropped: one mention per occasion.
// Recs pass through untouched. A failed plan falls back to a new cluster, so no idea is lost; but if EVERY idea's
// plan failed, it throws CompostUnavailableError so the claim is released and the whole item retried later.
// opts.span: a completed conversation's start/end, so an unmapped live mention of it counts as the same occasion.
// ponytail: sequential on purpose (each decision sees the previous ones); a conversation has a handful of ideas.
export async function planIdeaClusters(
  items: readonly SaveItem[], deps: Partial<CompostDeps> = {}, opts: { span?: OccasionSpan } = {},
): Promise<SaveItem[]> {
  const d: CompostDeps = { embedText, chooseCluster, writeTimelineNote, ...deps };
  const pending: Pending[] = [];
  const joined = new Set<number>();
  const out: SaveItem[] = [];
  let planned = 0;
  let failed = 0;
  for (const item of items) {
    if (item.kind !== "idea") {
      out.push(item);
      continue;
    }
    planned++;
    const { decision: chosen, ok, clusterTitle } = await decide(item, pending, joined, d, opts.span);
    if (!ok) failed++;
    if (chosen.action === "skip") continue;
    const decision = { ...chosen, timelineNote: await timelineNote(item, chosen, ok ? clusterTitle : null, d) };
    if (decision.action === "join") joined.add(decision.clusterId);
    if (decision.action === "create" && decision.embedding) {
      pending.push({ key: `n_${pending.length}`, title: item.extraction.title, excerpt: clampExcerpt(item.extraction.excerpt), pinned: false, embedding: decision.embedding });
    }
    out.push({ ...item, cluster: decision });
  }
  if (planned > 0 && failed === planned) throw new CompostUnavailableError(failed);
  return out;
}

async function decide(
  item: IdeaItem, pending: readonly Pending[], joined: ReadonlySet<number>, d: CompostDeps, span?: OccasionSpan,
): Promise<{ decision: Decision; ok: boolean; clusterTitle: string }> {
  const { title } = item.extraction;
  const excerpt = clampExcerpt(item.extraction.excerpt);
  let embedding: number[] | null = null;
  let stage = "embed";
  try {
    embedding = await d.embedText(`${title}. ${excerpt}`);
    const e = embedding;
    stage = "nearest";
    const stored = (await nearestClusters(e, NEAREST)).map((c) => ({
      option: { key: clusterKey(c.id), title: c.title, excerpt: c.excerpt, pinned: c.pinned }, clusterId: c.id as number | null, distance: c.distance,
    }));
    const planned = pending.map((p) => ({ option: { key: p.key, title: p.title, excerpt: p.excerpt, pinned: p.pinned }, clusterId: null, distance: cosineDistance(e, p.embedding) }));
    const nearest = [...stored, ...planned].sort((a, b) => a.distance - b.distance).slice(0, NEAREST);
    // Top of Mind: nearby pinned ideas the 5 nearest left out are offered after them (up to MAX_CLUSTER_OPTIONS in all).
    const pinned = (await pinnedClustersNear(e))
      .filter((c) => !nearest.some((o) => o.clusterId === c.id))
      .map((c) => ({ option: { key: clusterKey(c.id), title: c.title, excerpt: c.excerpt, pinned: true }, clusterId: c.id as number | null, distance: c.distance }));
    const offered = [...nearest, ...pinned].slice(0, MAX_CLUSTER_OPTIONS);
    stage = "choose";
    const { key } = await d.chooseCluster({ title, excerpt }, offered.map((o) => o.option));
    const chosen = offered.find((o) => o.option.key === key);
    if (!chosen) return { decision: { action: "create", embedding: e }, ok: true, clusterTitle: title };
    if (chosen.clusterId === null) return { decision: { action: "skip" }, ok: true, clusterTitle: title }; // same idea as one created earlier in this run
    if (joined.has(chosen.clusterId)) return { decision: { action: "skip" }, ok: true, clusterTitle: title };
    stage = "occasion";
    const occasion = {
      beeConversationId: item.beeConversationId, beeJournalId: item.beeJournalId, beeConversationUuid: item.beeConversationUuid, span,
      spokenAt: item.spokenAt,
    };
    if (await hasMentionFromSameOccasion(chosen.clusterId, occasion)) return { decision: { action: "skip" }, ok: true, clusterTitle: title };
    return { decision: { action: "join", clusterId: chosen.clusterId, embedding: e }, ok: true, clusterTitle: chosen.option.title };
  } catch (err) {
    // ids + error name only: messages can echo transcript text.
    console.error(
      `[compost] cluster choice failed conversation=${item.beeConversationId ?? "-"} journal=${item.beeJournalId ?? "-"} ` +
      `stage=${stage} error=${err instanceof Error ? err.name : "unknown"}; saving as a new idea`,
    );
    return { decision: { action: "create", embedding }, ok: false, clusterTitle: title };
  }
}

// The model writes only the short "what this mention added" text; the date is added by code (buildSaveQueries). Any
// failure (Gateway, or reading the prior lines) falls back to a code line: a lost note must never lose the mention.
// `clusterTitle` null: the plan already fell back to create, so skip the model and write "first heard".
async function timelineNote(item: IdeaItem, plan: ClusterPlan, clusterTitle: string | null, d: CompostDeps): Promise<string> {
  const fallback = plan.action === "join" ? NOTE_AGAIN : NOTE_FIRST;
  if (clusterTitle === null) return fallback;
  try {
    const prior = plan.action === "join" ? (await getClusterTimeline(plan.clusterId)).slice(-2).map((e) => e.line) : [];
    return await d.writeTimelineNote({ clusterTitle, priorLines: prior, excerpt: clampExcerpt(item.extraction.excerpt) });
  } catch (err) {
    console.error(
      `[compost] timeline note failed conversation=${item.beeConversationId ?? "-"} journal=${item.beeJournalId ?? "-"} ` +
      `error=${err instanceof Error ? err.name : "unknown"}; using the code line`,
    );
    return fallback;
  }
}
