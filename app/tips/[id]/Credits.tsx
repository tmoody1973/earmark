import { discogsFacts, type DiscogsExtras } from "@/agent/lib/enrich/discogs";

// "Credits & label" (decision 047). Every string below is React text. Discogs' API terms: "Data provided by Discogs."
// directly next to the data, linking to the discogs.com page it came from (no nofollow), and the trademark notice.
// d.url was checked by readDiscogs: our own https://www.discogs.com/release|artist/<id> shape and nothing else.
export function Credits({ discogs: d }: { discogs: DiscogsExtras }) {
  const facts = discogsFacts(d);
  if (!facts) return null;
  return (
    <section className="idea-panel" aria-labelledby="credits-h">
      <h2 id="credits-h">Credits &amp; label</h2>
      {facts.rows.length > 0 && (
        <dl className="tip-facts">
          {facts.rows.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {facts.tags.length > 0 && (
        <ul className="tip-tags" aria-label="Genres and styles">
          {facts.tags.map((t) => <li key={t}>{t}</li>)}
        </ul>
      )}
      {facts.credits.length > 0 && (
        <ul className="tip-credits">
          {facts.credits.map((c) => <li key={`${c.role}|${c.name}`}>{c.role} — {c.name}</li>)}
        </ul>
      )}
      <p className="tip-attribution">
        Data provided by <a href={d.url} rel="noopener noreferrer" target="_blank">Discogs</a>.
      </p>
      <p className="tip-attribution">This application uses Discogs’ API but is not affiliated with, sponsored or endorsed by Discogs. ‘Discogs’ is a trademark of Zink Media, LLC.</p>
    </section>
  );
}
