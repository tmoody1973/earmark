"use client";
import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import type { SerendipityPick } from "@/agent/lib/garden/serendipity";
import type { RecStatus } from "@/agent/lib/types";
import { compostSerendipity, keepSerendipity, undoCompostSerendipity } from "./actions";
import { IdeaPlant } from "./IdeaPlant";
import { RecCard } from "./cards/RecCard";
import { Icon } from "./cards/icons";
import "./cards/cards.css";

/*
 * Serendipity (M4-T8, FR-34, decision 029): one forgotten tip or stalled idea, shown as its own card or plant, with
 * Keep it / Let it compost. A tap hides it at once (optimistic) and the server sends the next one. Composting says so
 * and offers Undo. Nothing visible when nothing has gone quiet; the live region stays mounted (as in MaybeRow) so a
 * message is read even when the last item leaves. No orange: the accent means only new and bloomed.
 */

type UndoRef = { type: "rec"; id: number; previous: RecStatus } | { type: "idea"; id: number };
type Composted = { ref: UndoRef; title: string };

export function Serendipity({ pick }: { pick: SerendipityPick | null }) {
  const [shown, hide] = useOptimistic(pick, () => null);
  const [pending, startTransition] = useTransition();
  const [said, setSaid] = useState("");
  const [undoable, setUndoable] = useState<Composted | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const undoBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => { if (undoable) undoBtn.current?.focus(); }, [undoable]);

  // The item's buttons leave with it, so focus holds on the heading until there is somewhere better to go.
  function act(name: string, work: () => Promise<string>, hideItem = true) {
    heading.current?.focus();
    setUndoable(null);
    setSaid(""); // clear first, so the same message twice is announced again
    startTransition(async () => {
      if (hideItem) hide(null);
      try {
        setSaid(await work());
      } catch (err) {
        console.error(`serendipity ${name} failed`, (err as Error).name);
        setSaid("That didn’t save. Try again.");
      }
    });
  }

  const keep = (p: SerendipityPick) => act("keep", async () => {
    const { changed } = await keepSerendipity({ type: p.type, id: p.id });
    return changed ? `Kept “${p.title}”. It stays where it is.` : `“${p.title}” had already changed.`;
  });

  const compost = (p: SerendipityPick) => act("compost", async () => {
    const { changed, previous } = await compostSerendipity({ type: p.type, id: p.id });
    if (!changed) return `“${p.title}” had already changed.`;
    const ref: UndoRef = p.type === "rec" ? { type: "rec", id: p.id, previous: previous as RecStatus } : { type: "idea", id: p.id };
    setUndoable({ ref, title: p.title });
    return `“${p.title}” went back to the compost.`;
  });

  const undo = (c: Composted) => act("undo", async () => {
    const { changed } = await undoCompostSerendipity(c.ref);
    return changed ? `“${c.title}” is back.` : `“${c.title}” can’t come back from here now.`;
  }, false);

  const titleId = shown ? `${shown.type}-${shown.id}-title` : undefined;
  return (
    <>
      <p role="status" className="visually-hidden">{said}</p>
      {(shown || said || undoable || pending) && (
        <section className="zone serendipity" aria-labelledby="serendipity-h" data-testid="serendipity">
          <div className="zone-head">
            <h2 id="serendipity-h" ref={heading} tabIndex={-1}>Serendipity</h2>
          </div>
          <p className="serendipity-lede">Something you haven’t come back to in a while.</p>
          {said && (
            // Read once by the live region above; this copy is for the eye.
            <div className="serendipity-said">
              <p aria-hidden="true">{said}</p>
              {undoable && (
                <button type="button" ref={undoBtn} className="link-btn" aria-label={`Undo: bring back “${undoable.title}”`}
                  onClick={() => undo(undoable)}>
                  <Icon name="undo" size={16} />
                  Undo
                </button>
              )}
            </div>
          )}
          {shown && (
            <div className={`serendipity-item serendipity-item--${shown.type}`} data-testid="serendipity-item">
              {shown.type === "rec" ? <RecCard card={shown.rec} /> : <IdeaPlant plant={shown.plant} href={`/ideas/${shown.id}`} />}
              <div className="serendipity-aside">
                <p className="serendipity-note">{shown.note}</p>
                <div className="serendipity-actions">
                  {/* Visible label = accessible name (WCAG 2.5.3); the item's title rides along as the description. */}
                  <button type="button" className="link-btn link-btn--keep" aria-describedby={titleId} onClick={() => keep(shown)}>
                    <Icon name="check" size={16} />
                    Keep it
                  </button>
                  <button type="button" className="link-btn" aria-describedby={titleId} onClick={() => compost(shown)}>
                    Let it compost
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      )}
    </>
  );
}
