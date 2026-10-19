"use client";
import { useOptimistic, useState, useTransition } from "react";
import { heardMessage, heardWhen, type HeardChoice, type HeardItem } from "@/agent/lib/garden/heard";
import { TYPE_LABEL } from "../garden/cards/RecCard";
import { Icon } from "../garden/cards/icons";
import { clearHeard, keepHeard } from "./actions";

const ACTION = { keep: keepHeard, clear: clearHeard } as const;

/**
 * Heard nearby's rows (decision 052), each with Keep and Clear. As the Maybe? row (MaybeRow.tsx): a tap removes the
 * row at once (optimistic; it comes back if the save fails), says so in a live region, and moves focus to the next row.
 */
export function HeardList({ items, emptyFocusId }: { items: HeardItem[]; emptyFocusId: string }) {
  const [shown, hide] = useOptimistic(items, (list, id: number) => list.filter((t) => t.id !== id));
  const [, startTransition] = useTransition();
  const [said, setSaid] = useState("");

  function decide(item: HeardItem, choice: HeardChoice) {
    const i = shown.findIndex((t) => t.id === item.id);
    const next = shown[i + 1] ?? shown[i - 1];
    const target = document.getElementById(next ? `heard-${next.id}-keep` : emptyFocusId);
    if (target && !next) target.tabIndex = -1;
    target?.focus();
    setSaid(""); // clear first, so the same message twice (a repeat failure) is announced again
    startTransition(async () => {
      hide(item.id);
      let result: { changed: boolean } | null = null;
      try {
        result = await ACTION[choice](item.id);
      } catch (err) {
        console.error("heard verdict failed", item.id, (err as Error).name);
      }
      setSaid(heardMessage(choice, item.name, result));
    });
  }

  return (
    <>
      <p role="status" className="visually-hidden">{said}</p>
      {shown.length === 0 ? (
        <p className="empty">Nothing heard nearby in the last two weeks.</p>
      ) : (
        <ul className="maybe-list heard-list">
          {shown.map((t) => {
            const titleId = `heard-${t.id}-title`;
            return (
              <li key={t.id}>
                <article className="maybe-card" data-testid="heard-row" data-rec-id={t.id} aria-labelledby={titleId}>
                  <p className="rec-type">
                    <Icon name={t.type} size={15} />
                    {TYPE_LABEL[t.type]}
                  </p>
                  <h2 className="maybe-title" id={titleId}>{t.name}</h2>
                  <p className="heard-when">{heardWhen(t.heardAt)}</p>
                  {t.excerpt && <blockquote className="heard-quote">“{t.excerpt}”</blockquote>}
                  <div className="maybe-actions">
                    {/* Visible label = accessible name (WCAG 2.5.3); the name rides along as the description. */}
                    <button type="button" id={`heard-${t.id}-keep`} className="maybe-btn maybe-btn--keep"
                      aria-describedby={titleId} onClick={() => decide(t, "keep")}>
                      <Icon name="check" size={16} />
                      Keep
                    </button>
                    <button type="button" className="maybe-btn" aria-describedby={titleId} onClick={() => decide(t, "clear")}>
                      Clear
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
