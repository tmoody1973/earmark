import { db } from "../db";

export async function getCursor(name: string): Promise<string | null> {
  const rows = await db()`select cursor from sync_cursors where name = ${name}`;
  return rows.length ? String(rows[0]!.cursor) : null;
}

export async function saveCursor(name: string, cursor: string): Promise<void> {
  await db()`insert into sync_cursors (name, cursor) values (${name}, ${cursor})
             on conflict (name) do update set cursor = excluded.cursor, updated_at = now()`;
}
