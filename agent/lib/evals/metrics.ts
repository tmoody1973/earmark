export interface Prediction { label: string; predicted: string; confidence: number }

const correct = (p: Prediction) => (p.label === p.predicted ? 1 : 0);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round = (x: number) => Math.round(x * 1e6) / 1e6;

export function accuracy(preds: Prediction[]): number {
  return mean(preds.map(correct));
}

export function precisionFor(preds: Prediction[], cls: string): { precision: number | null; predicted: number } {
  const predicted = preds.filter((p) => p.predicted === cls);
  return { precision: predicted.length ? mean(predicted.map(correct)) : null, predicted: predicted.length };
}

function binIndex(confidence: number, bins: number): number {
  return Math.min(Math.floor(confidence * bins), bins - 1);
}

export function reliabilityTable(preds: Prediction[], bins = 10) {
  const groups = new Map<number, Prediction[]>();
  for (const p of preds) {
    // a missing probability (NaN) has no bin; it is excluded from calibration rather than poisoning it
    if (!Number.isFinite(p.confidence)) continue;
    const i = binIndex(p.confidence, bins);
    groups.set(i, [...(groups.get(i) ?? []), p]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([i, ps]) => ({
      lo: round(i / bins), hi: round((i + 1) / bins), count: ps.length,
      meanConfidence: round(mean(ps.map((p) => p.confidence))), accuracy: round(mean(ps.map(correct))),
    }));
}

export function ece(preds: Prediction[], bins = 10): number {
  const finite = preds.filter((p) => Number.isFinite(p.confidence));
  if (!finite.length) return 0;
  return reliabilityTable(finite, bins).reduce((sum, b) => sum + (b.count / finite.length) * Math.abs(b.accuracy - b.meanConfidence), 0);
}

export function brier(preds: Prediction[]): number {
  return mean(preds.filter((p) => Number.isFinite(p.confidence)).map((p) => (p.confidence - correct(p)) ** 2));
}

export function flipRate(predictionsPerSnippet: string[][]): number {
  return mean(predictionsPerSnippet.map((ps) => (new Set(ps).size > 1 ? 1 : 0)));
}
