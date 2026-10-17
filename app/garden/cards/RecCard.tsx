import type { RecCardData } from "@/agent/lib/garden/queries";
import type { RecType } from "@/agent/lib/types";
import { Artwork } from "./Artwork";
import { Icon } from "./icons";
import { TipCard, TipMenu, TipTag } from "./TipActions";
import "./cards.css";

export const TYPE_LABEL: Record<RecType, string> = {
  album: "Album", song: "Song", artist: "Artist", book: "Book",
  place: "Place", podcast: "Podcast", film_tv: "Film / TV", other: "Other",
};

/** A place's address is its "creator line"; everything else names its maker. */
export const cardSubline = (card: RecCardData) => (card.variant === "map" ? card.yearOrAddress : card.creator);

/**
 * One tip on the shelf. Every variant shares this anatomy; only the artwork differs (Artwork.tsx), and "other"
 * tips are compact note cards with no artwork box. Art sits above the text, never under it. The whole card
 * opens the item's link when it has one.
 * `actions`: the owner's "…" (Try this, Tried, a rating, Dismiss; FR-22). Off by default, so a page someone else
 * reads (a Space) never offers them.
 */
export function RecCard({ card, actions = false }: { card: RecCardData; actions?: boolean }) {
  const note = card.variant === "note";
  const subline = cardSubline(card);
  const titleId = `rec-${card.id}-title`;
  const classes = ["rec-card", note && "rec-card--note", card.link && "rec-card--linked"];
  return (
    <TipCard
      tip={{ id: card.id, name: card.name, status: card.status, rating: card.rating }}
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
        <TipTag />
        {/* Maybes (needs_review) never reach this card: they wait in the Maybe? row (MaybeRow.tsx, decision 025). */}
        <div className="rec-foot">
          {card.recommender && <p className="rec-from">from {card.recommender.firstName}</p>}
          {actions && <TipMenu titleId={titleId} />}
        </div>
      </div>
    </TipCard>
  );
}
