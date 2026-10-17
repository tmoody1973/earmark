"use client";
import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { matchesQuery } from "@/agent/lib/garden/search";
import type { NewChip } from "@/agent/lib/garden/visit";
import { FLOWER_OPENS_MS as CHIP_ARRIVES_MS, prefersReducedMotion } from "./bloom-motion";
import { Icon } from "./cards/icons";
import { useLive } from "./live";

// More than this and the row offers "See all" (wraps instead of scrolling sideways).
const ROW_GLANCE = 4;
// A scroll or touch this recent means his thumb is on the row: do not yank it back to the start.
const GESTURE_MS = 1_000;

/** "New since last time": tips caught and ideas bloomed since the last visit, plus blooms that arrive live. */
export function NewRow({ chips: served }: { chips: readonly NewChip[] }) {
  const live = useLive();
  const [open, setOpen] = useState(false);
  const [landed, setLanded] = useState<ReadonlySet<string>>(() => new Set());
  const row = useRef<HTMLUListElement>(null);
  const gestureAt = useRef(0);
  const arrived = live?.live.chips ?? [];
  const liveKeys = new Set(arrived.map((c) => c.key));
  const all = [...arrived, ...served.filter((c) => !liveKeys.has(c.key))];
  const query = live?.query ?? "";
  const matches = new Set(all.filter((c) => matchesQuery(query, [c.title, c.from])).map((c) => c.key));

  // A bloom arrives at the front of the row. Before the first paint, hold the chips after it where they were (a
  // transform, so nothing shifts), then glide them aside as the new chip slides in (shell.css: from 1.0 s).
  const newest = arrived[0]?.key;
  useLayoutEffect(() => {
    const el = row.current;
    const first = newest ? el?.querySelector<HTMLLIElement>(`li[data-key="${newest}"]`) : null;
    if (!el || !first || open || prefersReducedMotion()) return;
    const step = first.getBoundingClientRect().width + parseFloat(getComputedStyle(el).columnGap || "0");
    for (let li = first.nextElementSibling; li; li = li.nextElementSibling) {
      li.animate([{ transform: `translateX(${-step}px)` }, { transform: "none" }],
        { duration: 360, delay: CHIP_ARRIVES_MS, easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "backwards" });
    }
  }, [newest]); // eslint-disable-line react-hooks/exhaustive-deps -- once per arrival, in the layout it arrived in
  // ...and bring the row back to its start so it is seen, unless his thumb or focus is on the row.
  useEffect(() => {
    const el = row.current;
    if (!newest || !el) return;
    if (el.contains(document.activeElement) || Date.now() - gestureAt.current < GESTURE_MS) return;
    el.scrollTo({ left: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [newest]);
  const touched = () => { gestureAt.current = Date.now(); };

  return (
    <section className="new-row" aria-labelledby="new-h">
      <div className="new-head">
        <h2 id="new-h">
          {all.length > 0 && <span className="new-dot" aria-hidden="true" />}
          New since last time
        </h2>
        {matches.size > ROW_GLANCE && (
          <button type="button" className="new-all" aria-expanded={open} aria-controls="new-chips" onClick={() => setOpen(!open)}>
            {open ? "Show less" : "See all"}
            <Icon name="chevron" size={16} className={open ? "is-open" : undefined} />
          </button>
        )}
      </div>
      {matches.size === 0 && (
        <p className="new-empty">{all.length === 0 ? "Nothing new since you last looked." : "Nothing new matches."}</p>
      )}
      {/* Chips are hidden, never unmounted, by search: a chip that already slid in must not slide in again. */}
      {all.length > 0 && (
        <ul
          ref={row}
          id="new-chips"
          className={open ? "new-chips is-open" : "new-chips"}
          hidden={matches.size === 0}
          onScroll={touched}
          onPointerDown={touched}
          onTouchStart={touched}
        >
          {all.map((c) => (
            <li
              key={c.key}
              data-key={c.key}
              hidden={!matches.has(c.key)}
              className={liveKeys.has(c.key) && !landed.has(c.key) ? "is-live" : undefined}
              onAnimationEnd={liveKeys.has(c.key) ? () => setLanded((s) => new Set(s).add(c.key)) : undefined}
            >
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
