import type { RecCardData } from "@/agent/lib/garden/queries";
import type { Rating, RecType } from "@/agent/lib/types";
import { Artwork } from "./Artwork";
import { Icon } from "./icons";
import "./cards.css";

const TYPE_LABEL: Record<RecType, string> = {
  album: "Album", song: "Song", artist: "Artist", book: "Book",
  place: "Place", podcast: "Podcast", film_tv: "Film / TV", other: "Other",
};

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
  if (card.status !== "tried") return null;
  return <span className="rec-tag"><Icon name="check" size={14} />Tried</span>;
}

/**
 * One tip on the shelf. Every variant shares this anatomy; only the artwork differs (Artwork.tsx).
 * Art sits above the text, never under it. The whole card opens the item's link when it has one; keep/dismiss
 * are separate targets above that link.
 */
export function RecCard({ card }: { card: RecCardData }) {
  const unconfirmed = card.status === "needs_review";
  // A place's address is its "creator line"; everything else names its maker.
  const subline = card.variant === "map" ? card.yearOrAddress : card.creator;
  const titleId = `rec-${card.id}-title`;
  return (
    <article
      className={`rec-card${unconfirmed ? " rec-card--unconfirmed" : ""}${card.link ? " rec-card--linked" : ""}`}
      data-testid="rec-card"
      data-variant={card.variant}
      aria-labelledby={titleId}
    >
      <Artwork card={card} />
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
        <div className="rec-foot">
          {card.recommender && <p className="rec-from">from {card.recommender.firstName}</p>}
          {unconfirmed && (
            <div className="rec-review" role="group" aria-label={`Unconfirmed: keep or dismiss ${card.name}`}>
              <span className="rec-review-label">Unconfirmed</span>
              {/* TODO(M3-T10): wire to the rec server actions (app/actions/recs.ts) once they land; until then these
                  render disabled so the marker is designed but nothing pretends to work. */}
              <button type="button" className="rec-review-btn" disabled>Keep</button>
              <button type="button" className="rec-review-btn" disabled>Dismiss</button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
