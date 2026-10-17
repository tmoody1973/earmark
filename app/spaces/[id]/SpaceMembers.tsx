"use client";
import { useRouter } from "next/navigation";
import { useEffect, useOptimistic, useState, useTransition } from "react";
import type { SpaceIdea, SpaceItemKey, SpaceItemStatus, SpaceTip } from "@/agent/lib/garden/spaces";
import { keepSpaceItem, removeSpaceItem } from "@/app/garden/actions";
import { IdeaPlant } from "@/app/garden/IdeaPlant";
import { RecCard } from "@/app/garden/cards/RecCard";
import { Icon } from "@/app/garden/cards/icons";

/*
 * What Earmark put in a Space: ideas as plants, tips as shelf cards, each with Keep / Remove. A tap changes the item at
 * once (optimistic; it comes back if the save fails) and says so in a live region. A removed item leaves the Space
 * for good; a kept one is never re-judged. No orange: the accent means only new and bloomed.
 */

type Items = { ideas: SpaceIdea[]; tips: SpaceTip[] };
type Op = { hide: string } | { accept: string };
const keyOf = (k: SpaceItemKey) => `${k.itemType}:${k.itemId}`;

function reduce(view: Items, op: Op): Items {
  const after = <T extends { status: SpaceItemStatus }>(rows: T[], key: (r: T) => string) =>
    "hide" in op
      ? rows.filter((r) => key(r) !== op.hide)
      : rows.map((r) => (key(r) === op.accept ? { ...r, status: "accepted" as const } : r));
  return {
    ideas: after(view.ideas, (r) => `idea:${r.plant.id}`),
    tips: after(view.tips, (r) => `rec:${r.rec.id}`),
  };
}

// How often a Space still being sorted reloads itself, and for how long (the first fill takes about a minute; what is
// left after it waits for the hourly run, so the page stops asking).
const REFRESH_MS = 8_000;
const REFRESH_TIMES = 15;

export function SpaceMembers({ spaceId, ideas, tips, pending }: Items & { spaceId: number; pending: number }) {
  const router = useRouter();
  const [view, apply] = useOptimistic<Items, Op>({ ideas, tips }, reduce);
  const [, startTransition] = useTransition();
  const [said, setSaid] = useState("");

  useEffect(() => {
    if (pending === 0) return;
    let n = 0;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
      if (++n >= REFRESH_TIMES) window.clearInterval(timer);
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [pending, router]);

  function act(key: SpaceItemKey, title: string, verdict: "keep" | "remove") {
    if (verdict === "remove") document.getElementById("space-h")?.focus(); // the item leaves: hold focus on the Space's name
    setSaid(""); // clear first, so the same message twice is announced again
    startTransition(async () => {
      apply(verdict === "keep" ? { accept: keyOf(key) } : { hide: keyOf(key) });
      try {
        const { changed } = await (verdict === "keep" ? keepSpaceItem(key) : removeSpaceItem(key));
        setSaid(!changed ? `“${title}” had already changed. The page is up to date.` : verdict === "keep" ? `Kept “${title}” in this Space.` : `Removed “${title}” from this Space.`);
      } catch (err) {
        console.error("space item action failed", (err as Error).name);
        setSaid("That didn’t save. Try again.");
      }
    });
  }

  const empty = view.ideas.length === 0 && view.tips.length === 0;
  const sorting = `${pending} ${pending === 1 ? "item" : "items"}`;
  return (
    <>
      <p role="status" className="visually-hidden">{said}</p>
      {pending > 0 && (
        <p className="space-sorting" data-testid="space-sorting">
          <span className="space-sorting-dot" aria-hidden="true" />
          Still sorting {sorting}. This page fills in as Earmark goes.
        </p>
      )}
      {empty && pending === 0 && (
        <p className="empty space-empty">Nothing fits this Space yet. Earmark checks every new idea and tip against it.</p>
      )}

      {view.ideas.length > 0 && (
        <section className="zone" aria-labelledby="space-ideas-h">
          <div className="zone-head"><h2 id="space-ideas-h">Ideas</h2></div>
          <ul className="idea-bed">
            {view.ideas.map((i) => {
              const key: SpaceItemKey = { spaceId, itemType: "idea", itemId: i.plant.id };
              return (
                <li key={keyOf(key)} className="space-item" data-testid="space-idea" data-status={i.status}>
                  <IdeaPlant plant={i.plant} href={`/ideas/${i.plant.id}`} />
                  <ItemActions status={i.status} describedBy={`idea-${i.plant.id}-title`}
                    onKeep={() => act(key, i.plant.title, "keep")} onRemove={() => act(key, i.plant.title, "remove")} />
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {view.tips.length > 0 && (
        <section className="zone" aria-labelledby="space-tips-h">
          <div className="zone-head"><h2 id="space-tips-h">Tips</h2></div>
          <ul className="shelf-grid">
            {view.tips.map((t) => {
              const key: SpaceItemKey = { spaceId, itemType: "rec", itemId: t.rec.id };
              return (
                <li key={keyOf(key)} className="space-item" data-testid="space-tip" data-status={t.status}>
                  <RecCard card={t.rec} />
                  <ItemActions status={t.status} describedBy={`rec-${t.rec.id}-title`}
                    onKeep={() => act(key, t.rec.name, "keep")} onRemove={() => act(key, t.rec.name, "remove")} />
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}

// Visible label = accessible name (WCAG 2.5.3); the item's title rides along as the description.
function ItemActions({ status, describedBy, onKeep, onRemove }: {
  status: SpaceItemStatus; describedBy: string; onKeep: () => void; onRemove: () => void;
}) {
  return (
    <div className="space-item-actions">
      {status === "suggested" ? (
        <button type="button" className="link-btn link-btn--keep" aria-describedby={describedBy} onClick={onKeep}>
          <Icon name="check" size={16} />
          Keep
        </button>
      ) : (
        <span className="link-kept">Kept</span>
      )}
      <button type="button" className="link-btn" aria-describedby={describedBy} onClick={onRemove}>
        <Icon name="close" size={16} />
        Remove
      </button>
    </div>
  );
}
