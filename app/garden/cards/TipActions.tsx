"use client";
import {
  createContext, use, useEffect, useId, useOptimistic, useRef, useState, useTransition, type ComponentProps, type ReactNode,
} from "react";
import { isTried } from "@/agent/lib/garden/ledger";
import { applyChoice, CHOICE_LABEL, RATING_LABEL, RATINGS, tipChoices, tipMessage, type TipChoice } from "@/agent/lib/garden/tip";
import type { Rating, RecStatus } from "@/agent/lib/types";
import { chooseTip } from "../actions";
import { Icon } from "./icons";

// A tip's state on its card (M3-T10, FR-22). TipCard owns it, optimistically: a tap shows at once, and the card goes
// back as it was if the save fails. The tag and the "…" menu read it. No orange: that accent means only new and bloomed.

type Tip = { id: number; name: string; status: RecStatus; rating: Rating | null };
type State = { status: RecStatus; rating: Rating | null; gone: boolean };
const TipContext = createContext<{ tip: Tip; state: State; choose: (c: TipChoice) => void } | null>(null);
const useTip = () => use(TipContext)!;

// One polite region for every card, rendered by the root layout (#tip-announcer), so "Dismissed: …" is still read
// after the card (and its list item) is gone.
function announce(text: string) {
  const p = document.getElementById("tip-announcer");
  if (!p) return;
  p.textContent = ""; // cleared first, so the same message twice (a repeat failure) is read again
  requestAnimationFrame(() => { p.textContent = text; });
}

export function TipCard({ tip, children, ...article }: { tip: Tip; children: ReactNode } & ComponentProps<"article">) {
  const [state, apply] = useOptimistic<State, TipChoice>({ status: tip.status, rating: tip.rating, gone: false }, applyChoice);
  const [, startTransition] = useTransition();

  function choose(choice: TipChoice) {
    startTransition(async () => {
      apply(choice);
      let result: { changed: boolean } | null = null;
      try {
        result = await chooseTip(tip.id, choice);
      } catch (err) {
        console.error("tip choice failed", tip.id, (err as Error).name);
      }
      announce(tipMessage(choice, tip.name, result));
    });
  }

  if (state.gone) return null;
  return (
    <TipContext value={{ tip, state, choose }}>
      <article {...article}>{children}</article>
    </TipContext>
  );
}

/**
 * The quiet tag: the rating, else Tried (thanked counts, as in the taste ledger), else To try. Inside a TipCard it
 * follows the card's optimistic state; on a read-only card (no TipCard) it shows the tip as saved.
 */
export function TipTag(saved: { status: RecStatus; rating: Rating | null }) {
  const state = use(TipContext)?.state ?? saved;
  if (state.rating) {
    return (
      <span className={`rec-tag rec-tag--${state.rating}`}>
        {state.rating === "loved" && <Icon name="heart" size={14} />}
        {RATING_LABEL[state.rating]}
      </span>
    );
  }
  if (isTried(state)) return <span className="rec-tag"><Icon name="check" size={14} />Tried</span>;
  if (state.status === "queued") return <span className="rec-tag rec-tag--queued">To try</span>;
  return null;
}

/**
 * The card's one secondary control: "…" opens a short list over the card (a disclosure, not an ARIA menu, so Tab and
 * Enter work as everywhere else). Escape, a tap outside, or focus leaving closes it. Choosing closes it too.
 */
export function TipMenu() {
  const { tip, state, choose } = useTip();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    wrap.current?.querySelector<HTMLButtonElement>(".tip-choice")?.focus();
    const away = (e: Event) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      more.current?.focus();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("focusin", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("focusin", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  function pick(choice: TipChoice) {
    setOpen(false);
    if (choice === state.rating) { more.current?.focus(); return; } // the rating it already has: nothing to save
    if (choice === "dismiss") {
      // the card is about to go: focus moves to the next card's "…" (or the one before), never to the page top
      const all = Array.from(document.querySelectorAll<HTMLButtonElement>(".tip-more"));
      const i = all.indexOf(more.current!);
      (all[i + 1] ?? all[i - 1])?.focus();
    } else {
      more.current?.focus();
    }
    choose(choice);
  }

  return (
    <div className="tip-actions" ref={wrap}>
      <button
        ref={more}
        type="button"
        className="tip-more"
        aria-label={`Options for ${tip.name}`}
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="more" size={20} />
      </button>
      <ul className="tip-menu" id={listId} hidden={!open} aria-label={`Options for ${tip.name}`}>
        {tipChoices(state).map((c) => {
          const rating = (RATINGS as readonly string[]).includes(c);
          return (
            <li key={c}>
              <button
                type="button"
                className={`tip-choice tip-choice--${c}`}
                aria-pressed={rating ? state.rating === c : undefined}
                onClick={() => pick(c)}
              >
                {CHOICE_LABEL[c]}
                {rating && state.rating === c && <Icon name="check" size={16} />}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
