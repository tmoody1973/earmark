import { hoursNow, parseHours, weekLines, type PlaceExtras, type Reservation } from "@/agent/lib/enrich/place-details";
import { Icon } from "@/app/garden/cards/icons";

// "The place" (decision 058): stored OpenStreetMap facts, never fetched on page load. Every string is React text.
// "Open now" is worked out when the page renders, in Milwaukee time. OpenStreetMap's licence asks for the credit below.
const RESERVE: Record<Reservation, string> = {
  required: "Reservations required", recommended: "Reservations recommended", yes: "Takes reservations", no: "No reservations",
};

export function PlaceDetails({ place: p, now = new Date() }: { place: PlaceExtras; now?: Date }) {
  const week = p.hours ? parseHours(p.hours) : null;
  const status = week ? hoursNow(week, now) : null;
  const facts = [p.reservation && RESERVE[p.reservation], ...p.features].filter(Boolean);
  const links = [
    p.website && { label: "Website", href: p.website },
    p.menu && { label: "Menu", href: p.menu },
    p.reservationUrl && { label: "Reserve", href: p.reservationUrl },
    p.phone && { label: `Call ${p.phone}`, href: `tel:${p.phone.replace(/[^\d+]/g, "")}` },
  ].filter((l): l is { label: string; href: string } => !!l);
  if (!p.kind && !week && facts.length === 0 && links.length === 0) return null;
  return (
    <section className="idea-panel" aria-labelledby="place-h">
      <h2 id="place-h">The place</h2>
      {p.kind && <p className="tip-film-people">{p.kind}</p>}
      {(week || facts.length > 0) && (
        <dl className="tip-facts">
          {week && status && (
            <div>
              <dt>Hours</dt>
              <dd>
                <span className="tip-open">{status.open ? `Open now${status.until ? ` · until ${status.until}` : ""}` : "Closed now"}</span>
                <ul className="tip-hours">{weekLines(week).map((l) => <li key={l}>{l}</li>)}</ul>
              </dd>
            </div>
          )}
          {facts.length > 0 && (
            <div>
              <dt>Good to know</dt>
              <dd>{facts.join(" · ")}</dd>
            </div>
          )}
        </dl>
      )}
      {links.length > 0 && (
        <ul className="tip-links">
          {links.map((l) => (
            <li key={l.href}>
              <a className="idea-action" href={l.href} rel="noopener noreferrer" target={l.href.startsWith("tel:") ? undefined : "_blank"}>
                <Icon name="external" size={18} />
                {l.label}
              </a>
            </li>
          ))}
        </ul>
      )}
      <p className="tip-attribution">
        Place details © <a href="https://www.openstreetmap.org/copyright" rel="noopener noreferrer" target="_blank">OpenStreetMap contributors</a>.
      </p>
    </section>
  );
}
