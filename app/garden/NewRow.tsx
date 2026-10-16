"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { matchesQuery } from "@/agent/lib/garden/search";
import type { NewChip } from "@/agent/lib/garden/visit";
import { prefersReducedMotion } from "./bloom-motion";
import { Icon } from "./cards/icons";
import { useLive } from "./live";

// More than this and the row offers "See all" (wraps instead of scrolling sideways).
const ROW_GLANCE = 4;

/** "New since last time": tips caught and ideas bloomed since the last visit, plus blooms that arrive live. */
export function NewRow({ chips: served }: { chips: readonly NewChip[] }) {
  const live = useLive();
  const [open, setOpen] = useState(false);
  const row = useRef<HTMLUListElement>(null);
  const arrived = live?.live.chips ?? [];
  const newest = arrived[0]?.key;
  // A bloom arrives at the front of the row: bring the row back to its start so it is seen.
  useEffect(() => {
    if (newest) row.current?.scrollTo({ left: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [newest]);
  const liveKeys = new Set(arrived.map((c) => c.key));
  const all = [...arrived, ...served.filter((c) => !liveKeys.has(c.key))];
  const query = live?.query ?? "";
  const chips = all.filter((c) => matchesQuery(query, [c.title, c.meta]));

  return (
    <section className="new-row" aria-labelledby="new-h">
      <div className="new-head">
        <h2 id="new-h">
          {all.length > 0 && <span className="new-dot" aria-hidden="true" />}
          New since last time
        </h2>
        {chips.length > ROW_GLANCE && (
          <button type="button" className="new-all" aria-expanded={open} aria-controls="new-chips" onClick={() => setOpen(!open)}>
            {open ? "Show less" : "See all"}
            <Icon name="chevron" size={16} className={open ? "is-open" : undefined} />
          </button>
        )}
      </div>
      {chips.length === 0 ? (
        <p className="new-empty">{all.length === 0 ? "Nothing new since you last looked." : "Nothing new matches."}</p>
      ) : (
        <ul ref={row} id="new-chips" className={open ? "new-chips is-open" : "new-chips"}>
          {chips.map((c) => (
            <li key={c.key} className={liveKeys.has(c.key) ? "is-live" : undefined}>
              <Link className={`new-chip new-chip--${c.kind}`} href={c.href} data-testid="new-chip" data-key={c.key}>
                <Icon name={c.kind === "bloom" ? "sprout" : c.type} size={20} className="new-chip-icon" />
                <span className="new-chip-text">
                  <span className="new-chip-title">{c.title}</span>
                  <span className="new-chip-meta">{c.meta}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
