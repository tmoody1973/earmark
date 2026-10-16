import type { Route, TriageResult } from "../types";

// Starting points from the PRD (FR-05); M2's eval harness tunes them per model.
export const ACCEPT_ABOVE = 0.85;
export const DROP_BELOW = 0.5;

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
