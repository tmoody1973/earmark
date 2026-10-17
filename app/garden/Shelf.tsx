import type { RecCardData } from "@/agent/lib/garden/queries";
import { RecCard } from "./cards/RecCard";
import { Findable } from "./live";

/** The shelf zone: two columns on a phone, widening to four on desktop. */
export function Shelf({ cards }: { cards: RecCardData[] }) {
  if (cards.length === 0) {
    return (
      <p className="empty">
        Nothing on the shelf yet. Say “Earmark that, Ann’s ramen spot” to your Bee, and the tip lands here with her name on it.
      </p>
    );
  }
  return (
    <ul className="shelf-grid">
      {cards.map((c) => (
        <Findable key={c.id} fields={[c.name, c.recommender?.firstName]}>
          <RecCard card={c} actions />
        </Findable>
      ))}
    </ul>
  );
}
