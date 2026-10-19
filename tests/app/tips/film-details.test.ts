import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { filmFromTmdb, type FilmExtras } from "../../../agent/lib/enrich/extras";
import { FilmDetails } from "../../../app/tips/[id]/FilmDetails";

const fx = (name: string) => JSON.parse(readFileSync(`${import.meta.dirname}/../../fixtures/enrich/${name}.json`, "utf8"));
const SHOW = filmFromTmdb(fx("tmdb-tv-shogun"), "tv")!;
const MOVIE = filmFromTmdb(fx("tmdb-movie-dune-part-two"), "movie")!;
const html = (film: FilmExtras, year: string | null = "2024") => renderToStaticMarkup(createElement(FilmDetails, { film, year }));

describe("FilmDetails (the film/show section of a tip page)", () => {
  it("a show: heading, synopsis, the meta line, created by, cast, and where to watch with the JustWatch credit", () => {
    const h = html(SHOW);
    expect(h).toContain(">The show</h2>");
    expect(h).toContain("In Japan in the year 1600");
    expect(h).toContain("2024 · 1 season · 10 episodes · Drama, War &amp; Politics");
    expect(h).toContain("Created by Rachel Kondo and Justin Marks");
    expect(h).toContain("With Hiroyuki Sanada, Cosmo Jarvis, Anna Sawai, and Tadanobu Asano");
    expect(h).toContain("Where to watch");
    expect(h).toContain("Stream");
    expect(h).toContain("<span>Disney Plus</span>"); // the name as text: the logo is decoration (alt="")
    expect(h).toContain('src="https://image.tmdb.org/t/p/w92/5eZ872CghnHFLB1j8grszbrx0dx.png"');
    expect(h).toContain('alt=""');
    expect(h).toContain('href="https://www.themoviedb.org/tv/126308-shogun/watch?locale=US"');
    expect(h).toContain("More ways to watch");
    expect(h).toContain('Where to watch data by <a href="https://www.justwatch.com"');
    expect(h).not.toContain("Rent or buy"); // an empty group says nothing
  });

  it("a movie: 'The film', runtime in hours, directed by, groups in order stream → rent or buy", () => {
    const h = html(MOVIE);
    expect(h).toContain(">The film</h2>");
    expect(h).toContain("2024 · 2 h 47 min · Science Fiction, Adventure");
    expect(h).toContain("Directed by Denis Villeneuve");
    expect(h.indexOf("Stream")).toBeLessThan(h.indexOf("Rent or buy"));
  });

  it("free comes between stream and rent or buy", () => {
    const watch = { ...MOVIE.watch!, free: [{ name: "Tubi TV", logoUrl: null }] };
    const h = html({ ...MOVIE, watch });
    expect(h.indexOf("Stream")).toBeLessThan(h.indexOf(">Free<"));
    expect(h.indexOf(">Free<")).toBeLessThan(h.indexOf("Rent or buy"));
    expect(h).toContain("<span>Tubi TV</span>");
  });

  it("each part is optional; no providers means no JustWatch credit; nothing at all renders nothing", () => {
    const h = html({ ...MOVIE, watch: null, cast: [], by: [] }, null);
    expect(h).not.toContain("Where to watch");
    expect(h).not.toContain("JustWatch");
    expect(h).not.toContain("Directed by");
    expect(h).not.toContain("With ");
    expect(h).toContain("2 h 47 min · Science Fiction");
    expect(html({ ...SHOW, overview: null })).not.toContain("In Japan");
    expect(html({ kind: "movie", overview: null, genres: [], runtime: null, seasons: null, episodes: null, by: [], cast: [],
      watch: null, trailer: "U2Qp5pL3ovA" }, null)).toBe("");
  });
});
