"use client";
import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { heardWhen } from "@/agent/lib/garden/heard";
import { heardOnceMessage, type HeardOnceChoice, type HeardOnceIdea, type UndoStage } from "@/agent/lib/garden/quiet-ideas";
import { Icon } from "../garden/cards/icons";
import { dismissIdeaAction, keepHeardOnce, undoDismissIdeaAction } from "../garden/actions";

type Undoable = { id: number; previous: UndoStage; title: string };

/**
 * Heard once's rows (decision 055), each with Keep and Dismiss, as Heard nearby's (HeardList.tsx): a tap removes the
 * row at once (optimistic; it comes back if the save fails), says so in a live region, and moves focus to the next
 * row. A dismissal offers Undo, as Serendipity's compost does (Serendipity.tsx), and focus goes to it.
 */
export function HeardOnceList({ items, emptyFocusId }: { items: HeardOnceIdea[]; emptyFocusId: string }) {
  const [shown, hide] = useOptimistic(items, (list, id: number) => list.filter((t) => t.id !== id));
  const [, startTransition] = useTransition();
  const [said, setSaid] = useState("");
  const [undoable, setUndoable] = useState<Undoable | null>(null);
  const undoBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => { if (undoable) undoBtn.current?.focus(); }, [undoable]);

  function focusAfter(item: HeardOnceIdea | null) {
    const i = item ? shown.findIndex((t) => t.id === item.id) : -1;
    const next = item ? (shown[i + 1] ?? shown[i - 1]) : undefined;
    const target = document.getElementById(next ? `heard-once-${next.id}-keep` : emptyFocusId);
    if (target && !next) target.tabIndex = -1;
    target?.focus();
  }

  function decide(item: HeardOnceIdea, choice: HeardOnceChoice) {
    focusAfter(item);
    setUndoable(null);
    setSaid(""); // clear first, so the same message twice (a repeat failure) is announced again
    startTransition(async () => {
      hide(item.id);
      let result: { changed: boolean } | null = null;
      try {
        if (choice === "keep") result = await keepHeardOnce(item.id);
        else {
          const r = await dismissIdeaAction(item.id);
          result = r;
          if (r.changed && r.previous) setUndoable({ id: item.id, previous: r.previous, title: item.title });
        }
      } catch (err) {
        console.error("heard once choice failed", item.id, (err as Error).name);
      }
      setSaid(heardOnceMessage(choice, item.title, result));
    });
  }

  function undo(u: Undoable) {
    focusAfter(null);
    setUndoable(null);
    setSaid("");
    startTransition(async () => {
      let changed = false;
      try {
        changed = (await undoDismissIdeaAction({ id: u.id, previous: u.previous })).changed;
      } catch (err) {
        console.error("heard once undo failed", u.id, (err as Error).name);
      }
      setSaid(changed ? `Back: ${u.title}` : `${u.title} can’t come back from here now.`);
    });
  }

  return (
    <>
      <p role="status" className="visually-hidden">{said}</p>
      {said && (
        // Read once by the live region above; this copy is for the eye.
        <div className="heard-said">
          <p aria-hidden="true">{said}</p>
          {undoable && (
            <button type="button" ref={undoBtn} className="maybe-btn" aria-label={`Undo: bring back ${undoable.title}`}
              onClick={() => undo(undoable)}>
              <Icon name="undo" size={16} />
              Undo
            </button>
          )}
        </div>
      )}
      {shown.length === 0 ? (
        <p className="empty">Nothing heard just once in the last two weeks.</p>
      ) : (
        <ul className="maybe-list heard-list">
          {shown.map((t) => {
            const titleId = `heard-once-${t.id}-title`;
            return (
              <li key={t.id}>
                <article className="maybe-card" data-testid="heard-once-row" data-idea-id={t.id} aria-labelledby={titleId}>
                  <h2 className="maybe-title" id={titleId}>{t.title}</h2>
                  <p className="heard-when">{heardWhen(t.heardAt)}</p>
                  {t.excerpt && <blockquote className="heard-quote">“{t.excerpt}”</blockquote>}
                  <div className="maybe-actions">
                    {/* Visible label = accessible name (WCAG 2.5.3); the title rides along as the description. */}
                    <button type="button" id={`heard-once-${t.id}-keep`} className="maybe-btn maybe-btn--keep"
                      aria-describedby={titleId} onClick={() => decide(t, "keep")}>
                      <Icon name="check" size={16} />
                      Keep
                    </button>
                    <button type="button" className="maybe-btn" aria-describedby={titleId} onClick={() => decide(t, "dismiss")}>
                      Dismiss
                    </button>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
