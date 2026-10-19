// Quiet ideas (decision 055). An idea overheard once stays out of every list of ideas until a second occasion makes it
// sprout; the rule is one SQL function, idea_is_quiet (migration 045), that each listing query calls. "Heard once"
// lists the quiet ones, findable but never pushed (no badge, no count), with Keep and Dismiss. Dismiss also works from
// an idea's own page, with an Undo for an hour.
import { db } from "../db";
import { gardenReadOnly } from "../e2e-guard";
import type { IdeaStage } from "../types";

export const HEARD_ONCE_DAYS = 14;
export const HEARD_ONCE_MAX = 50;
export const UNDO_STAGES = ["compost", "sprouting", "ready", "drafted", "used"] as const satisfies readonly IdeaStage[];
export type UndoStage = (typeof UNDO_STAGES)[number];

export interface HeardOnceIdea { id: number; title: string; heardAt: string; excerpt: string }

const assertId = (id: number) => {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("invalid idea id");
};

// Newest first. The excerpt is the newest counted mention's stored ≤25 words; a dismissed mention's never shows.
export async function getHeardOnce(): Promise<HeardOnceIdea[]> {
  const rows = (await db()`
    select c.id, c.title, c.last_mentioned_at,
      (select m.excerpt from idea_mentions m where m.cluster_id = c.id and m.review_status <> 'dismissed'
        order by m.spoken_at desc, m.id desc limit 1) as excerpt
    from idea_clusters c
    where c.stage = 'compost' and c.last_mentioned_at >= now() - ${HEARD_ONCE_DAYS}::int * interval '1 day'
      and idea_is_quiet(c.id)
    order by c.last_mentioned_at desc, c.id desc limit ${HEARD_ONCE_MAX}`) as Array<{
      id: number | string; title: string; last_mentioned_at: Date | string; excerpt: string | null;
    }>;
  return rows.map((r) => ({ id: Number(r.id), title: r.title, heardAt: new Date(r.last_mentioned_at).toISOString(), excerpt: r.excerpt ?? "" }));
}

/** Keep: a quiet idea shows in the garden now. False when it was not quiet (already kept, grown, deliberate, gone). */
export async function keepIdea(id: number): Promise<boolean> {
  assertId(id);
  if (gardenReadOnly()) return false; // a real-data e2e run browses read-only (e2e-guard.ts)
  return (await db()`update idea_clusters set kept_at = now() where id = ${id} and idea_is_quiet(id) returning id`).length > 0;
}

export type DismissResult = { changed: boolean; previous: UndoStage | null };

/**
 * Dismiss any idea that is not dismissed yet, drafted and used ones too. `previous` is the stage it left, for Undo.
 * compost.ts keeps a dismissed idea dismissed when it is mentioned again.
 */
export async function dismissIdea(id: number): Promise<DismissResult> {
  assertId(id);
  if (gardenReadOnly()) return { changed: false, previous: null };
  const [r] = (await db()`
    update idea_clusters set stage = 'dismissed', updated_at = now() where id = ${id} and stage <> 'dismissed'
    returning old.stage as previous`) as Array<{ previous: UndoStage }>;
  return r ? { changed: true, previous: r.previous } : { changed: false, previous: null };
}

/**
 * Undo a dismissal within the hour (updated_at: Dismiss set it). drafted and used come back as they were; a growth
 * stage is recounted (idea_stage_for), so a mention that joined meanwhile still counts and a stale page can't inflate
 * it. Never a merge's dismissal: undoMerge (merge.ts) puts that back.
 */
export async function undoDismissIdea(id: number, previous: UndoStage): Promise<boolean> {
  assertId(id);
  if (!UNDO_STAGES.includes(previous)) throw new Error("invalid previous stage");
  if (gardenReadOnly()) return false;
  const rows = await db()`
    update idea_clusters c
    set stage = case when ${previous}::text in ('drafted', 'used') then ${previous}::text else idea_stage_for('compost', c.mention_count) end,
      updated_at = now()
    where c.id = ${id} and c.stage = 'dismissed' and c.updated_at > now() - interval '1 hour'
      and not exists (select 1 from idea_merges mg where mg.merged_id = c.id and mg.undone_at is null)
    returning c.id`;
  return rows.length > 0;
}

export type HeardOnceChoice = "keep" | "dismiss";

// What the list's live region says after a tap. `result` null: the save failed.
export function heardOnceMessage(choice: HeardOnceChoice, title: string, result: { changed: boolean } | null): string {
  if (!result) return `Couldn't save that. ${title} is back in the list; try again.`;
  if (!result.changed) return `Already handled: ${title}`;
  return choice === "keep" ? `Kept: ${title}. It’s in your garden now.` : `Dismissed: ${title}`;
}
