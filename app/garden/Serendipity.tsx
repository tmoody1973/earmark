"use client";
import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import type { SerendipityPick } from "@/agent/lib/garden/serendipity";
import { compostSerendipity, keepSerendipity, notNowSerendipity, undoCompostSerendipity } from "./actions";
import { IdeaPlant } from "./IdeaPlant";
import { RecCard } from "./cards/RecCard";
import { Icon } from "./cards/icons";
import "./cards/cards.css";

/*
 * Serendipity (M4-T8, FR-34, decision 029): one forgotten tip or stalled idea, shown as its own card or plant. A tip:
 * Keep it / Let it compost (with Undo). An idea: Keep it / Not now (rests it; it stays in the garden). A tap hides it at
 * once (optimistic) and the server sends the next one. Nothing visible when nothing has gone quiet; the live region stays mounted (as in MaybeRow) so a
 * message is read even when the last item leaves. No orange: the accent means only new and bloomed.
 */

type Composted = { id: number; previous: "new" | "queued"; title: string };

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

  // An idea is never dismissed from here: Not now rests it (Tarik's "Rest it" ruling, decision 029).
  const notNow = (id: number, title: string) => act("not-now", async () => {
    const { changed } = await notNowSerendipity(id);
    return changed ? "Resting — it’ll come back around in a couple of months." : `“${title}” had already changed.`;
  });

  // A tip's compost is a real verdict (status composted, Bee todo cleared), so it gets an Undo.
  const compost = (id: number, title: string) => act("compost", async () => {
    const { changed, previous } = await compostSerendipity(id);
    if (!changed) return `“${title}” had already changed.`;
    setUndoable({ id, previous: previous as Composted["previous"], title });
    return `“${title}” went back to the compost.`;
  });

  const undo = (c: Composted) => act("undo", async () => {
    const { changed } = await undoCompostSerendipity({ id: c.id, previous: c.previous });
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
                  {shown.type === "rec" ? (
                    <button type="button" className="link-btn" aria-describedby={titleId} onClick={() => compost(shown.id, shown.title)}>
                      Let it compost
                    </button>
                  ) : (
                    <button type="button" className="link-btn" aria-describedby={titleId} onClick={() => notNow(shown.id, shown.title)}>
                      Not now
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </section>
      )}
    </>
  );
}
