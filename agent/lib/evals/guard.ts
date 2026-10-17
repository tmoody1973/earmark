import { PRICE_PER_M_INPUT } from "./report";

export const MAX_ERROR_RATE = 0.1;

// Printed before any Gateway call. ponytail: avgInputTokens is a flat guess (window + criteria), not measured.
export function costPlan(o: { n: number; models: string[]; orders: number; avgInputTokens: number }) {
  const calls = o.n * o.models.length * o.orders;
  const estUsd = o.models.reduce((sum, m) => sum + ((o.n * o.orders * o.avgInputTokens) / 1_000_000) * (PRICE_PER_M_INPUT[m] ?? 0), 0);
  return { calls, estUsd, summary: `${o.n} × ${o.models.length} models × ${o.orders} orders = ${calls} calls, est. $${estUsd.toFixed(4)}` };
}

// A reason string means "do not write the report"; null means fine.
export function shouldAbortWrite(succeeded: number, errored: number): string | null {
  if (succeeded === 0) return "no snippets succeeded";
  const rate = errored / (succeeded + errored);
  return rate > MAX_ERROR_RATE ? `${Math.round(rate * 100)}% of snippets errored (limit ${MAX_ERROR_RATE * 100}%)` : null;
}
