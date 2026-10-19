import type { FilmExtras, WatchProvider } from "@/agent/lib/enrich/extras";

// "The film" / "The show" (decision 056): stored TMDB facts, never fetched on page load. Every string is React text.
// Where-to-watch data comes from JustWatch through TMDB; TMDB's terms ask for the JustWatch credit next to it.
const and = new Intl.ListFormat("en", { style: "long", type: "conjunction" });
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const duration = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ""}`);

/** "2024 · 2 h 47 min · Science Fiction, Adventure" or "2024 · 1 season · 10 episodes · Drama". Pure. */
export function filmMeta(f: FilmExtras, year: string | null): string {
  return [year, f.runtime && duration(f.runtime), f.seasons && plural(f.seasons, "season"), f.episodes && plural(f.episodes, "episode"),
    f.genres.join(", ")].filter(Boolean).join(" · ");
}

function Providers({ id, label, list }: { id: string; label: string; list: WatchProvider[] }) {
  if (list.length === 0) return null;
  return (
    <>
      <p className="tip-watch-label" id={id}>{label}</p>
      <ul className="tip-providers" aria-labelledby={id}>
        {list.map((p) => (
          <li key={p.name}>
            {/* eslint-disable-next-line @next/next/no-img-element -- like Img.tsx: a remote logo, the name says it all */}
            {p.logoUrl && <img src={p.logoUrl} alt="" width={32} height={32} loading="lazy" decoding="async" referrerPolicy="no-referrer" />}
            <span>{p.name}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

export function FilmDetails({ film: f, year }: { film: FilmExtras; year: string | null }) {
  const meta = filmMeta(f, year);
  const w = f.watch;
  if (!f.overview && !meta && f.by.length === 0 && f.cast.length === 0 && !w) return null;
  return (
    <section className="idea-panel" aria-labelledby="film-h">
      <h2 id="film-h">{f.kind === "tv" ? "The show" : "The film"}</h2>
      {f.overview && <p className="tip-book">{f.overview}</p>}
      {meta && <p className="idea-quiet">{meta}</p>}
      {f.by.length > 0 && <p className="tip-film-people">{f.kind === "tv" ? "Created by" : "Directed by"} {and.format(f.by)}</p>}
      {f.cast.length > 0 && <p className="tip-film-people">With {and.format(f.cast)}</p>}
      {w && (
        <div className="tip-watch">
          <h3 id="watch-h">Where to watch</h3>
          <Providers id="watch-stream" label="Stream" list={w.stream} />
          <Providers id="watch-free" label="Free" list={w.free} />
          <Providers id="watch-rent" label="Rent or buy" list={w.rentBuy} />
          <p className="tip-attribution">
            <a href={w.link} rel="noopener noreferrer" target="_blank">More ways to watch</a>
          </p>
          <p className="tip-attribution">
            Where to watch data by <a href="https://www.justwatch.com" rel="noopener noreferrer" target="_blank">JustWatch</a>.
          </p>
        </div>
      )}
    </section>
  );
}
