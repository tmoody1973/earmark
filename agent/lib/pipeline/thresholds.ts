import type { Route } from "../types";

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
