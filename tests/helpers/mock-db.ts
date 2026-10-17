import { vi } from "vitest";

export interface DbCall { text: string; values: unknown[] }

/** Build a stand-in for db(): records every tagged-template call, returns queued rows in order. */
export function makeMockDb() {
  const calls: DbCall[] = [];
  const queue: unknown[][] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join("?"), values });
    return Promise.resolve(queue.shift() ?? []);
  }) as unknown as ((s: TemplateStringsArray, ...v: unknown[]) => Promise<unknown[]>) & {
    transaction: ReturnType<typeof vi.fn>;
  };
  sql.transaction = vi.fn(async (qs: Promise<unknown>[]) => Promise.all(qs));
  return { sql, calls, queue };
}
