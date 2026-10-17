"use client";
import Link from "next/link";
import { useOptimistic, useRef, useState, useTransition } from "react";
import type { Backlinks as Links, IdeaBacklink, LinkKey, MergeRef, RecBacklink } from "@/agent/lib/garden/backlinks";
import { stageLabel } from "@/agent/lib/garden/plant";
import { formatTimelineDate } from "@/agent/lib/ideas/timeline-format";
import { acceptLink, mergeIdeas, removeLink, undoIdeaMerge } from "@/app/garden/actions";
import { PlantArt } from "@/app/garden/PlantArt";
import { cardSubline, TYPE_LABEL } from "@/app/garden/cards/RecCard";
import { Icon } from "@/app/garden/cards/icons";

/*
 * "Connected" on the idea page (FR-38): ideas Earmark found related, tips that fit, and "same idea?" merge offers,
 * each with Keep / Remove (or Merge here / Not the same). Jev suggests, Tarik decides; nothing is filed for him.
 * A tap changes the row at once (optimistic; it comes back if the save fails) and says so in a live region.
 * Merging asks first, inline, and stays undoable (decision 027). No orange: the accent means only new and bloomed.
 */

const keyOf = (k: LinkKey) => `${k.kind}:${k.fromType}:${k.fromId}:${k.toId}`;
type Op = { hide: string } | { accept: string };

function reduce(view: Links, op: Op): Links {
  const keep = <T extends { key: LinkKey }>(rows: T[]) => ("hide" in op ? rows.filter((r) => keyOf(r.key) !== op.hide) : rows);
  const mark = <T extends { key: LinkKey; status: string }>(rows: T[]) =>
    "accept" in op ? rows.map((r) => (keyOf(r.key) === op.accept ? { ...r, status: "accepted" as const } : r)) : rows;
  return { ...view, related: mark(keep(view.related)), fits: mark(keep(view.fits)), sameIdea: keep(view.sameIdea) };
}

const mentions = (n: number) => `${n} mention${n === 1 ? "" : "s"}`;

export function Backlinks({ ideaId, links }: { ideaId: number; links: Links }) {
  const [view, apply] = useOptimistic(links, reduce);
  const [, startTransition] = useTransition();
  const [said, setSaid] = useState("");
  const [confirming, setConfirming] = useState<number | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  // Runs one action: the optimistic change first, then the save; the live region says what happened either way.
  function act(op: Op | null, run: () => Promise<unknown>, done: string) {
    setSaid(""); // clear first, so the same message twice is announced again
    startTransition(async () => {
      if (op) apply(op);
      try {
        await run();
        setSaid(done);
      } catch (err) {
        console.error("backlink action failed", (err as Error).name);
        setSaid("That didn’t save. Try again.");
      }
    });
  }
  // After a row leaves, focus would fall to the page: hold it on the panel heading instead.
  const refocus = () => heading.current?.focus();

  const remove = (k: LinkKey, title: string) => {
    refocus();
    act({ hide: keyOf(k) }, () => removeLink(k), `Removed the link to “${title}”.`);
  };
  const keep = (k: LinkKey, title: string) => act({ accept: keyOf(k) }, () => acceptLink(k), `Kept the link to “${title}”.`);
  const notSame = (l: IdeaBacklink) => {
    refocus();
    act({ hide: keyOf(l.key) }, () => removeLink(l.key), `Noted: “${l.plant.title}” is a different idea.`);
  };
  const merge = (l: IdeaBacklink) => {
    setConfirming(null);
    refocus();
    act({ hide: keyOf(l.key) }, () => mergeIdeas(ideaId, l.plant.id), `Merged “${l.plant.title}” into this idea. You can undo it under Merged in.`);
  };
  const undo = (m: MergeRef) => {
    refocus();
    act(null, () => undoIdeaMerge(m.mergeId), `Undone: “${m.title}” is its own idea again.`);
  };

  const empty = !view.related.length && !view.fits.length && !view.sameIdea.length && !view.mergedIn.length;
  return (
    <>
      <p role="status" className="visually-hidden">{said}</p>
      {!empty && (
        <section className="idea-panel links" aria-labelledby="links-h" id="links">
          <h2 id="links-h" ref={heading} tabIndex={-1}>Connected</h2>

          {view.sameIdea.length > 0 && (
            <div className="links-group" aria-labelledby="links-same-h">
              <h3 id="links-same-h">Same idea?</h3>
              <ul className="links-list">
                {view.sameIdea.map((l) => (
                  <li key={keyOf(l.key)} className="link-row" data-testid="link-same">
                    <IdeaMain link={l} />
                    {confirming === l.plant.id ? (
                      <div className="link-confirm" role="group" aria-label={`Merge “${l.plant.title}” into this idea?`}>
                        <p>Move its {mentions(l.plant.mentionCount)} here? You can undo it.</p>
                        <div className="link-actions">
                          <button type="button" className="link-btn link-btn--keep" onClick={() => merge(l)}>Merge</button>
                          <button type="button" className="link-btn" onClick={() => setConfirming(null)}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div className="link-actions">
                        <button type="button" className="link-btn link-btn--keep" onClick={() => setConfirming(l.plant.id)}>
                          Merge here
                        </button>
                        <button type="button" className="link-btn" onClick={() => notSame(l)}>Not the same</button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {view.related.length > 0 && (
            <div className="links-group" aria-labelledby="links-related-h">
              <h3 id="links-related-h">Related ideas</h3>
              <ul className="links-list">
                {view.related.map((l) => (
                  <li key={keyOf(l.key)} className="link-row" data-testid="link-related" data-status={l.status}>
                    <IdeaMain link={l} />
                    <LinkActions status={l.status} title={l.plant.title} onKeep={() => keep(l.key, l.plant.title)} onRemove={() => remove(l.key, l.plant.title)} />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {view.fits.length > 0 && (
            <div className="links-group" aria-labelledby="links-fits-h">
              <h3 id="links-fits-h">Tips that fit</h3>
              <ul className="links-list">
                {view.fits.map((l) => (
                  <li key={keyOf(l.key)} className="link-row" data-testid="link-fits" data-status={l.status}>
                    <RecMain link={l} />
                    <LinkActions status={l.status} title={l.rec.name} onKeep={() => keep(l.key, l.rec.name)} onRemove={() => remove(l.key, l.rec.name)} />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {view.mergedIn.length > 0 && (
            <div className="links-group" aria-labelledby="links-merged-h">
              <h3 id="links-merged-h">Merged in</h3>
              <ul className="links-list">
                {view.mergedIn.map((m) => (
                  <li key={m.mergeId} className="link-row" data-testid="link-merged">
                    <Link href={`/ideas/${m.ideaId}`} className="link-main link-main--plain">
                      <span className="link-text">
                        <span className="link-title">{m.title}</span>
                        <span className="link-meta">Merged {formatTimelineDate(new Date(m.at))}</span>
                      </span>
                    </Link>
                    <div className="link-actions">
                      <button type="button" className="link-btn" onClick={() => undo(m)}>
                        <Icon name="undo" size={16} />
                        Undo merge
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </>
  );
}

function IdeaMain({ link }: { link: IdeaBacklink }) {
  const p = link.plant;
  return (
    <Link href={`/ideas/${p.id}`} className="link-main">
      <PlantArt plant={p} size="sm" decorative />
      <span className="link-text">
        <span className="link-title">{p.title}</span>
        <span className="link-meta">{stageLabel(p.stage)} · {mentions(p.mentionCount)}</span>
      </span>
    </Link>
  );
}

function RecMain({ link }: { link: RecBacklink }) {
  const r = link.rec;
  const sub = cardSubline(r);
  const from = r.recommender ? `from ${r.recommender.firstName}` : null;
  const inner = (
    <>
      <span className="link-art" aria-hidden="true"><Icon name={r.type} size={22} /></span>
      <span className="link-text">
        <span className="link-title">{r.name}</span>
        <span className="link-meta">{[TYPE_LABEL[r.type], sub, from].filter(Boolean).join(" · ")}</span>
      </span>
    </>
  );
  // A tip has no page of its own: its card's link (where to listen, read or go) when it has one.
  return r.link ? (
    <a href={r.link} className="link-main" rel="noopener noreferrer" target="_blank">{inner}</a>
  ) : (
    <div className="link-main">{inner}</div>
  );
}

function LinkActions({ status, title, onKeep, onRemove }: { status: string; title: string; onKeep: () => void; onRemove: () => void }) {
  return (
    <div className="link-actions">
      {status === "suggested" ? (
        <button type="button" className="link-btn link-btn--keep" onClick={onKeep} aria-label={`Keep the link to ${title}`}>
          <Icon name="check" size={16} />
          Keep
        </button>
      ) : (
        <span className="link-kept">Kept</span>
      )}
      <button type="button" className="link-btn" onClick={onRemove} aria-label={`Remove the link to ${title}`}>
        <Icon name="close" size={16} />
        Remove
      </button>
    </div>
  );
}

/**
 * On a merged idea's page: where it went, and Undo. Always mounted (merge null renders only the live region), so the
 * announcement survives the re-render after the undo, when the note itself goes away.
 */
export function MergedNote({ merge }: { merge: MergeRef | null }) {
  const [pending, startTransition] = useTransition();
  const [said, setSaid] = useState("");
  const undo = (m: MergeRef) => {
    setSaid("");
    startTransition(async () => {
      try {
        const r = await undoIdeaMerge(m.mergeId);
        setSaid(r.changed ? "Undone: this is its own idea again." : "This merge was already undone.");
      } catch (err) {
        console.error("undo merge failed", (err as Error).name);
        setSaid("That didn’t save. Try again.");
      }
    });
  };
  return (
    <>
      {merge && (
        <div className="idea-merged">
          <p className="idea-note">
            Merged into <Link href={`/ideas/${merge.ideaId}`}>{merge.title}</Link>. Its mentions live there now; this
            page stays so nothing is lost.
          </p>
          <button type="button" className="idea-action" disabled={pending} onClick={() => undo(merge)}>
            <Icon name="undo" size={18} />
            Undo merge
          </button>
        </div>
      )}
      <p role="status" className={merge ? "idea-action-status" : said ? "idea-note" : "visually-hidden"}>{said}</p>
    </>
  );
}
