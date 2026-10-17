import type { Route, TriageResult } from "../types";

// Chosen from the labeled eval for Jev (M2-T10, docs/decisions/009). PRD starting points were 0.85 / 0.5.
// ponytail: 48 labels; below 0.6 Jev's rec/idea calls were 1/14, 1/21 and 0/36 right over three runs; above 0.9 rests on
// 2 predictions. Re-tune on fresh labels (the eve gate needs n >= 5 accepted per class).
export const ACCEPT_ABOVE = 0.9;
export const DROP_BELOW = 0.6;

// Triage drops a window when jokingProbability is above this.
export const JOKING_MAX = 0.5;

export function routeByConfidence(p: number): Route {
  if (!Number.isFinite(p) || p < DROP_BELOW) return "drop";
  return p > ACCEPT_ABOVE ? "accept" : "review";
}

// Ambient triage drops a window when broadcastProbability is above this. Voice notes are exempt (explicit capture).
export const BROADCAST_MAX = 0.5;

// The gates every ambient window passes (completed conversations and the live stream alike): something found, not
// broadcast audio (a missing answer fails closed), not a joke, not the user's own recommendation, confident enough.
// null = drop the window; otherwise the confidence route of what it found.
export function windowRoute(t: TriageResult): Exclude<Route, "drop"> | null {
  if (t.kind === "neither" || t.kind === "rec_by_user") return null;
  if (!(t.broadcastProbability <= BROADCAST_MAX)) return null;
  if (t.jokingProbability > JOKING_MAX) return null;
  const route = routeByConfidence(t.kindProbability);
  return route === "drop" ? null : route;
}
