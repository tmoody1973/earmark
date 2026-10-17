import { z } from "zod";
import { db } from "../db";

export async function getCursor(name: string): Promise<string | null> {
  const rows = await db()`select cursor from sync_cursors where name = ${name}`;
  return rows.length ? String(rows[0]!.cursor) : null;
}

// Forward only: a stale or replayed run can never move the bookmark back. Bee cursors are `v1-<epochMs>`; compare the
// numeric tail (not the text, so a width change cannot reorder them). A cursor with no numeric tail is accepted as-is.
export async function saveCursor(name: string, cursor: string): Promise<void> {
  await db()`insert into sync_cursors (name, cursor) values (${name}, ${cursor})
             on conflict (name) do update set cursor = excluded.cursor, updated_at = now()
             where coalesce(substring(sync_cursors.cursor from '[0-9]+$')::numeric, -1)
                 < coalesce(substring(excluded.cursor from '[0-9]+$')::numeric, 1e30)`;
}

// Items the feed listed but that were not ready yet (conversation still capturing, voice note still transcribing), and
// todo/fact changes whose handler threw (retried with an attempt count, M3-T8).
// Stored as JSON text in sync_cursors (no extra table); retried on every run.
export const BEE_PENDING = "bee_changes_pending";

const Retry = z.object({ id: z.number(), attempts: z.number() });
const PendingSchema = z.object({
  conversations: z.array(z.object({ id: z.number(), firstSeen: z.string() })).default([]),
  journals: z.array(z.object({ id: z.string(), firstSeen: z.string() })).default([]),
  todos: z.array(Retry).default([]),
  facts: z.array(Retry).default([]),
});
export type Pending = z.infer<typeof PendingSchema>;
export const emptyPending = (): Pending => ({ conversations: [], journals: [], todos: [], facts: [] });

export async function getPending(): Promise<Pending> {
  const raw = await getCursor(BEE_PENDING);
  if (!raw) return emptyPending();
  try {
    return PendingSchema.parse(JSON.parse(raw));
  } catch {
    console.error("[bee-changes] pending list unreadable; starting empty (the nightly backfill is the backstop)");
    return emptyPending();
  }
}

export async function savePending(p: Pending): Promise<void> {
  await db()`insert into sync_cursors (name, cursor) values (${BEE_PENDING}, ${JSON.stringify(p)})
             on conflict (name) do update set cursor = excluded.cursor, updated_at = now()`;
}
