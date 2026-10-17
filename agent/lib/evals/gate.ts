// What the eve triage gate grades: precision of what production would auto-accept, not of every raw answer.
// Routes come from the shipped routeByConfidence, so the gate cannot drift from the thresholds.
import { routeByConfidence } from "../pipeline/thresholds";
import { precisionFor, type Prediction } from "./metrics";

// Under this many accepted predictions a precision is an anecdote: the gate reports "insufficient", never a pass.
export const MIN_GATE_N = 5;

export function gateStats(preds: Prediction[], cls: "rec_to_user" | "idea_by_user") {
  const route = (p: Prediction) => routeByConfidence(p.confidence);
  const accepted = precisionFor(preds.filter((p) => route(p) === "accept"), cls);
  const kept = precisionFor(preds.filter((p) => route(p) !== "drop"), cls);
  const found = preds.filter((p) => p.label === cls && p.predicted === cls);
  return {
    accepted: { precision: accepted.precision, n: accepted.predicted, sufficient: accepted.predicted >= MIN_GATE_N },
    kept: { precision: kept.precision, n: kept.predicted },
    // coverage proxies (candidates were pre-selected, so true recall is not measurable): labeled runs of this class
    // that production would keep, and that it would auto-accept
    coverage: {
      labeled: preds.filter((p) => p.label === cls).length,
      kept: found.filter((p) => route(p) !== "drop").length,
      accepted: found.filter((p) => route(p) === "accept").length,
    },
  };
}
