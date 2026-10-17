// Suggests ACCEPT_ABOVE / DROP_BELOW from a labeled eval report. Suggestions only: a person picks the shipped values
// (docs/decisions/009), because 48 labels cannot carry a fine-grained threshold on their own.
import { precisionFor, type Prediction } from "./metrics";

export const ACCEPT_CANDIDATES = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95];
export const DROP_CANDIDATES = [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6];
const POSITIVE = (p: Prediction) => p.predicted === "rec_to_user" || p.predicted === "idea_by_user";

// Lowest candidate where the accepted (confidence > t) rec and idea predictions both meet their precision targets.
// A class with no accepted predictions has no precision (null) and does not block. recAccepted/ideaAccepted say how
// many predictions the precision rests on: under ~5 it is an anecdote, not a measurement.
export function pickAcceptThreshold(preds: Prediction[], target: { rec: number; idea: number }) {
  for (const t of ACCEPT_CANDIDATES) {
    const accepted = preds.filter((p) => p.confidence > t);
    const rec = precisionFor(accepted, "rec_to_user");
    const idea = precisionFor(accepted, "idea_by_user");
    if ((rec.precision === null || rec.precision >= target.rec) && (idea.precision === null || idea.precision >= target.idea)) {
      return {
        threshold: t, recPrecision: rec.precision, ideaPrecision: idea.precision, recAccepted: rec.predicted, ideaAccepted: idea.predicted,
        acceptedShare: accepted.filter(POSITIVE).length / Math.max(1, preds.filter(POSITIVE).length),
      };
    }
  }
  return { threshold: 0.95, recPrecision: null, ideaPrecision: null, recAccepted: 0, ideaAccepted: 0, acceptedShare: 0 };
}

// Walks the drop line up band by band ([previous candidate, t)) while the positive predictions in each band are mostly
// (≥ 50%) wrong, and stops at the first band that is mostly right. Empty bands are no evidence and do not move the line.
// With no evidence at all, keep the 0.5 default (always below the accept line).
export function pickDropThreshold(preds: Prediction[], acceptAbove: number): number {
  let chosen: number | null = null;
  let lo = 0;
  for (const t of DROP_CANDIDATES.filter((c) => c < acceptAbove)) {
    const band = preds.filter((p) => POSITIVE(p) && p.confidence >= lo && p.confidence < t);
    lo = t;
    if (band.length === 0) continue;
    const correctShare = band.filter((p) => p.label === p.predicted).length / band.length;
    if (correctShare > 0.5) break;
    chosen = t;
  }
  return chosen ?? Math.min(0.5, acceptAbove - 0.05);
}
