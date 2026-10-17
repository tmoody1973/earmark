import Link from "next/link";
import { isTried } from "@/agent/lib/garden/ledger";
import type { RecCardData } from "@/agent/lib/garden/queries";
import type { Rating, RecType } from "@/agent/lib/types";
import { Artwork } from "./Artwork";
import { Icon } from "./icons";
import "./cards.css";

export const TYPE_LABEL: Record<RecType, string> = {
  album: "Album", song: "Song", artist: "Artist", book: "Book",
  place: "Place", podcast: "Podcast", film_tv: "Film / TV", other: "Other",
};

/** A place's address is its "creator line"; everything else names its maker. */
export const cardSubline = (card: RecCardData) => (card.variant === "map" ? card.yearOrAddress : card.creator);

const RATING_LABEL: Record<Rating, string> = { loved: "Loved it", fine: "It was fine", not_for_me: "Not for me" };

function TriedTag({ card }: { card: RecCardData }) {
  if (card.rating) {
    return (
      <span className={`rec-tag rec-tag--${card.rating}`}>
        {card.rating === "loved" && <Icon name="heart" size={14} />}
        {RATING_LABEL[card.rating]}
      </span>
    );
  }
  if (!isTried(card)) return null; // thanked counts as tried, as in the taste ledger
  return <span className="rec-tag"><Icon name="check" size={14} />Tried</span>;
}

/**
 * One tip on the shelf. Every variant shares this anatomy; only the artwork differs (Artwork.tsx), and "other"
 * tips are compact note cards with no artwork box. Art sits above the text, never under it. The whole card
 * opens the item's link when it has one.
 */
export function RecCard({ card }: { card: RecCardData }) {
  const note = card.variant === "note";
  const subline = cardSubline(card);
  const titleId = `rec-${card.id}-title`;
  const classes = ["rec-card", note && "rec-card--note", card.link && "rec-card--linked"];
  return (
    <article
      id={`rec-${card.id}`}
      className={classes.filter(Boolean).join(" ")}
      data-testid="rec-card"
      data-variant={card.variant}
      aria-labelledby={titleId}
    >
      {!note && <Artwork card={card} />}
      <div className="rec-body">
        <p className="rec-type">
          <Icon name={card.type} size={15} />
          {TYPE_LABEL[card.type]}
        </p>
        <h3 className="rec-title" id={titleId}>
          {card.link ? <a className="rec-link" href={card.link} rel="noopener noreferrer">{card.name}</a> : card.name}
        </h3>
        {subline && <p className="rec-sub">{subline}</p>}
        {card.why && <p className="rec-why">“{card.why}”</p>}
        <TriedTag card={card} />
        {/* Maybes (needs_review) never reach this card: they wait in the Maybe? row (MaybeRow.tsx, decision 025). */}
        <div className="rec-foot">
          {card.recommender && <p className="rec-from">from {card.recommender.firstName}</p>}
          {/* Outside the title link (no nested <a>); card.recommender is already owner-guarded (credit). FR-24 */}
          {card.rating === "loved" && card.recommender && (
            <Link className="rec-thank" href={`/receipts/${card.id}`}>Thank {card.recommender.firstName}</Link>
          )}
        </div>
      </div>
    </article>
  );
}
