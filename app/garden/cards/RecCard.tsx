import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { recCardHref } from "@/agent/lib/garden/cards";
import type { RecCardData } from "@/agent/lib/garden/queries";
import type { RecType } from "@/agent/lib/types";
import { Artwork } from "./Artwork";
import { Icon } from "./icons";
import { TipCard, TipMenu, TipTag } from "./TipActions";
import "./cards.css";

export const TYPE_LABEL: Record<RecType, string> = {
  album: "Album", song: "Song", artist: "Artist", book: "Book",
  place: "Place", podcast: "Podcast", film_tv: "Film / TV", video: "Video", other: "Other",
};

/** A place's address is its "creator line"; everything else names its maker. */
export const cardSubline = (card: RecCardData) => (card.variant === "map" ? card.yearOrAddress : card.creator);

/**
 * One tip on the shelf. Every variant shares this anatomy; only the artwork differs (Artwork.tsx), and "other"
 * tips are compact note cards with no artwork box. Art sits above the text, never under it. The whole card is one
 * link (recCardHref): the owner's cards (`actions`) open the tip's own page, /tips/<id>; a card someone else reads
 * opens the item's external link when it has one.
 * `actions`: the owner's "…" (Try this, Tried, a rating, Dismiss; FR-22). Off by default, so a page someone else
 * reads (a Space) never offers them, and gets a plain article with no client state.
 * `from`: off on a person's own page, where "from Ann" would only repeat the heading (Thank Ann still shows).
 */
export function RecCard({ card, actions = false, from = true }: { card: RecCardData; actions?: boolean; from?: boolean }) {
  const note = card.variant === "note";
  const subline = cardSubline(card);
  const titleId = actions ? `rec-${card.id}-title` : undefined; // ids stay off public pages
  const href = recCardHref(card, actions);
  const classes = ["rec-card", note && "rec-card--note", href && "rec-card--linked"];
  const article: ComponentProps<"article"> & { "data-testid": string; "data-variant": string } = {
    // The #rec-<id> anchor (/shelf?rec=<id>) is private: a public /s page must not expose sequential ids.
    ...(actions && { id: `rec-${card.id}` }),
    className: classes.filter(Boolean).join(" "),
    "data-testid": "rec-card",
    "data-variant": card.variant,
    ...(titleId ? { "aria-labelledby": titleId } : { "aria-label": card.name }),
  };
  const body: ReactNode = (
    <>
      {!note && <Artwork card={card} />}
      <div className="rec-body">
        <p className="rec-type">
          <Icon name={card.type} size={15} />
          {TYPE_LABEL[card.type]}
        </p>
        <h3 className="rec-title" id={titleId}>
          {actions && href ? (
            <Link className="rec-link" href={href}>{card.name}</Link>
          ) : href ? (
            <a className="rec-link" href={href} rel="noopener noreferrer">{card.name}</a>
          ) : (
            card.name
          )}
        </h3>
        {subline && <p className="rec-sub">{subline}</p>}
        {card.why && <p className="rec-why">“{card.why}”</p>}
        {/* What, not why (M3-T4b): a quiet line under the why, with its source as its own small link. */}
        {card.about && (
          <p className="rec-about">
            {card.about.text}{" "}
            <a className="rec-about-src" href={card.about.url} rel="noopener noreferrer">Wikipedia</a>
          </p>
        )}
        <TipTag status={card.status} rating={card.rating} />
        {/* Maybes (needs_review) never reach this card: they wait in the Maybe? row (MaybeRow.tsx, decision 025). */}
        <div className="rec-foot">
          {from && card.recommender && <p className="rec-from">from {card.recommender.firstName}</p>}
          {/* Outside the title link (no nested <a>); card.recommender is already owner-guarded (credit). FR-24 */}
          {card.rating === "loved" && card.recommender && (
            <Link className="rec-thank" href={`/receipts/${card.id}`}>Thank {card.recommender.firstName}</Link>
          )}
          {actions && <TipMenu />}
        </div>
      </div>
    </>
  );
  if (!actions) return <article {...article}>{body}</article>;
  return (
    <TipCard tip={{ id: card.id, name: card.name, status: card.status, rating: card.rating }} {...article}>
      {body}
    </TipCard>
  );
}
