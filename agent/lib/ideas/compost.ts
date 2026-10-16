import { clampExcerpt } from "../pipeline/excerpt";
import type { ClusterPlan, SaveItem } from "../pipeline/save-item";
import { hasMentionFromSameOccasion, nearestClusters } from "../store/ideas";
import { chooseCluster, clusterKey, type ClusterOption } from "./choose-cluster";
import { embedText } from "./embed";

export interface CompostDeps {
  embedText: (text: string) => Promise<number[]>;
  chooseCluster: (idea: { title: string; excerpt: string }, options: ClusterOption[]) => Promise<{ key: string | null }>;
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
// For each accepted idea, in order: embed it, offer Jev the nearest stored clusters plus the clusters this run is
// about to create, and attach the decision. An idea whose chosen cluster already has a mention from the same
// conversation or voice note (stored, or planned earlier in this run) is dropped: one mention per occasion.
// Recs and needs_review ideas pass through untouched. Never rejects: a failed embedding or choice falls back to a
// new cluster, so no idea is lost.
// ponytail: sequential on purpose (each decision sees the previous ones); a conversation has a handful of ideas.
export async function planIdeaClusters(items: readonly SaveItem[], deps: Partial<CompostDeps> = {}): Promise<SaveItem[]> {
  const d: CompostDeps = { embedText, chooseCluster, ...deps };
  const pending: Pending[] = [];
  const joined = new Set<number>();
  const out: SaveItem[] = [];
  for (const item of items) {
    if (item.kind !== "idea" || item.route !== "accept") {
      out.push(item);
      continue;
    }
    const decision = await decide(item, pending, joined, d);
    if (decision.action === "skip") continue;
    if (decision.action === "join") joined.add(decision.clusterId);
    if (decision.action === "create" && decision.embedding) {
      pending.push({ key: `n_${pending.length}`, title: item.extraction.title, excerpt: clampExcerpt(item.extraction.excerpt), pinned: false, embedding: decision.embedding });
    }
    out.push({ ...item, cluster: decision });
  }
  return out;
}

async function decide(item: IdeaItem, pending: readonly Pending[], joined: ReadonlySet<number>, d: CompostDeps): Promise<Decision> {
  const { title } = item.extraction;
  const excerpt = clampExcerpt(item.extraction.excerpt);
  let embedding: number[] | null = null;
  try {
    embedding = await d.embedText(`${title}. ${excerpt}`);
    const e = embedding;
    const stored = (await nearestClusters(e, NEAREST)).map((c) => ({
      option: { key: clusterKey(c.id), title: c.title, excerpt: c.excerpt, pinned: c.pinned }, clusterId: c.id as number | null, distance: c.distance,
    }));
    const planned = pending.map((p) => ({ option: { key: p.key, title: p.title, excerpt: p.excerpt, pinned: p.pinned }, clusterId: null, distance: cosineDistance(e, p.embedding) }));
    const offered = [...stored, ...planned].sort((a, b) => a.distance - b.distance).slice(0, NEAREST);
    const { key } = await d.chooseCluster({ title, excerpt }, offered.map((o) => o.option));
    const chosen = offered.find((o) => o.option.key === key);
    if (!chosen) return { action: "create", embedding: e };
    if (chosen.clusterId === null) return { action: "skip" }; // same idea as one created earlier in this run
    if (joined.has(chosen.clusterId) || (await hasMentionFromSameOccasion(chosen.clusterId, { beeConversationId: item.beeConversationId, beeJournalId: item.beeJournalId }))) return { action: "skip" };
    return { action: "join", clusterId: chosen.clusterId, embedding: e };
  } catch (err) {
    // ids + error name only: messages can echo transcript text.
    console.error(
      `[compost] cluster choice failed conversation=${item.beeConversationId ?? "-"} journal=${item.beeJournalId ?? "-"} ` +
      `stage=${embedding ? "choose" : "embed"} error=${err instanceof Error ? err.name : "unknown"}; saving as a new idea`,
    );
    return { action: "create", embedding };
  }
}
