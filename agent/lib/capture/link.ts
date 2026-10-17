import { experimental_decide as decide } from "ai";
import { toDate, type BeeClient } from "../bee/client";
import { getEnv, ownerFirstName } from "../env";
import { distanceMeters, type LatLng } from "../geo";
import { toWindows } from "../pipeline/windows";
import { utterancesOf } from "../pipeline/process-conversation";
import { extractRecommendation } from "../pipeline/extract";
import { chooseRecommender } from "../pipeline/attribution";
import { clampExcerpt } from "../pipeline/excerpt";
import { WINDOW_PICK_MIN } from "../pipeline/thresholds";
import type { AttributionSource, TranscriptWindow } from "../types";

export const LINK_WINDOW_MS = 10 * 60 * 1000; // FR-09: within 10 minutes
export const LINK_RADIUS_M = 500; // "nearby"
const MAX_WINDOWS = 8; // Jev: short state, few options
const LETTERS = "abcdefgh";

export interface LinkedConversation {
  conversationId: number;
  summary: string | null;
  windows: TranscriptWindow[];
}

export async function findConversationNear(
  bee: BeeClient,
  at: Date,
  where: LatLng | null,
): Promise<LinkedConversation | null> {
  const t = at.getTime();
  const candidates: { id: number; start: number; end: number }[] = [];
  let cursor: string | undefined;
  // ponytail: scans at most 3 pages (60 conversations). Bee lists conversations newest first (checked on 16 real
  // conversations), so the early exit below stops once a page's oldest conversation is a day before the capture.
  for (let page = 0; page < 3; page++) {
    const res = await bee.listConversations({ limit: 20, cursor });
    for (const c of res.conversations) {
      const start = toDate(c.start_time)?.getTime();
      if (start === undefined) continue; // no start time: cannot be placed in time, never treat it as the epoch
      const end = toDate(c.end_time)?.getTime() ?? Date.now();
      if (t >= start - LINK_WINDOW_MS && t <= end + LINK_WINDOW_MS) candidates.push({ id: c.id, start, end });
    }
    // Oldest DATED conversation on the page: an undated one must not read as the epoch and end the scan early.
    const starts = res.conversations.flatMap((c) => toDate(c.start_time)?.getTime() ?? []);
    const oldest = starts.length ? Math.min(...starts) : Number.POSITIVE_INFINITY;
    if (!res.next_cursor || oldest < t - 24 * 3600_000) break;
    cursor = res.next_cursor;
  }
  // Conversations whose [start, end] contains the capture time first, then the nearest interval; ties by start.
  const away = (c: { start: number; end: number }) => (t < c.start ? c.start - t : t > c.end ? t - c.end : 0);
  candidates.sort((a, b) => away(a) - away(b) || Math.abs(a.start - t) - Math.abs(b.start - t));

  for (const cand of candidates) {
    const { conversation } = await bee.getConversation(cand.id);
    const loc = conversation.primary_location;
    if (where && loc && distanceMeters(where, { lat: loc.latitude, lng: loc.longitude }) > LINK_RADIUS_M) continue;
    const gap = (w: TranscriptWindow) => (w.startedAt ? Math.abs(w.startedAt.getTime() - t) : Number.POSITIVE_INFINITY);
    const windows = toWindows(utterancesOf(conversation), { conversationId: conversation.id, conversationUuid: null })
      .filter((w) => !w.startedAt || gap(w) <= LINK_WINDOW_MS)
      .sort((a, b) => gap(a) - gap(b))
      .slice(0, MAX_WINDOWS);
    if (windows.length === 0) continue; // nothing said near the capture time: try the next candidate
    return { conversationId: conversation.id, summary: conversation.summary ?? null, windows };
  }
  return null;
}

export async function pickWindowForCapture(
  capture: string,
  windows: TranscriptWindow[],
  decideImpl: typeof decide = decide,
): Promise<{ window: TranscriptWindow; probability: number } | null> {
  if (windows.length === 0) return null;
  const keyed = windows.slice(0, MAX_WINDOWS).map((w, i) => [`w_${LETTERS[i]}`, w] as const);
  const criteria: Record<string, string> = {};
  for (const [key] of keyed) {
    criteria[key] = `Window \`${key}\` in \`windows\` talks about the item in \`capture\`, by its name or by clearly describing it.`;
  }
  criteria.none = "No window in `windows` talks about the item in `capture`.";
  const result = await decideImpl({
    model: getEnv().TRIAGE_MODEL,
    state: { capture, windows: Object.fromEntries(keyed.map(([k, w]) => [k, w.text])) },
    questions: {
      window: {
        type: "choice",
        instructions: "Which window in `windows` talks about the item described in `capture`?",
        criteria,
      },
    },
  });
  const answer = result.answers.window;
  if (answer.type !== "choice" || answer.choice === "none") return null;
  const probability = answer.probabilities?.[answer.choice] ?? 0;
  if (probability < WINDOW_PICK_MIN) return null;
  const hit = keyed.find(([k]) => k === answer.choice);
  return hit ? { window: hit[1], probability } : null;
}

export async function attributeFromWindow(
  window: TranscriptWindow,
  summary: string | null,
  extract: typeof extractRecommendation = extractRecommendation,
): Promise<{ firstName: string | null; source: AttributionSource; excerpt: string }> {
  const ext = await extract({ text: window.text, summary });
  const chosen = chooseRecommender({
    triggerName: null,
    windowName: ext.recommenderName,
    windowText: window.text,
    summaryName: null,
    summaryText: summary,
    ownerFirstName: ownerFirstName(),
  });
  return { firstName: chosen.firstName, source: chosen.source, excerpt: clampExcerpt(ext.excerpt) };
}
