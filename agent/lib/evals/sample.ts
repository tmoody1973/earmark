import type { ItemKind } from "../types";

export interface Candidate { id: string; conv: number; kind: ItemKind; window: string }

// Names seen on Tarik's real shelf as false positives: company, tool and publication names said in work talk.
// ponytail: a fixed list; extend it when new junk shows up on the shelf.
const WORK_TALK = /radio milwaukee|new york times|datawrapper/i;
export const isWorkTalk = (window: string): boolean => WORK_TALK.test(window);

function shuffled<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

// Likely positives: triage says idea or rec (max N per conversation for variety). Likely negatives: work-talk windows the
// model called positive first (the false positives to check), then random "neither" windows.
export function pickSample(
  candidates: readonly Candidate[],
  opts: { positives: number; negatives: number; maxPerConversation: number; shuffle?: <T>(xs: T[]) => T[] },
): { positives: Candidate[]; negatives: Candidate[] } {
  const shuffle = opts.shuffle ?? shuffled;
  const checks = candidates.filter((c) => c.kind !== "neither" && isWorkTalk(c.window));
  const plainPositives = candidates.filter((c) => c.kind !== "neither" && !isWorkTalk(c.window));
  const perConv = new Map<number, number>();
  const positives: Candidate[] = [];
  for (const c of shuffle(plainPositives)) {
    if (positives.length >= opts.positives) break;
    const n = perConv.get(c.conv) ?? 0;
    if (n >= opts.maxPerConversation) continue;
    perConv.set(c.conv, n + 1);
    positives.push(c);
  }
  const negatives = [...checks, ...shuffle(candidates.filter((c) => c.kind === "neither"))].slice(0, opts.negatives);
  return { positives, negatives };
}
