import { existsSync, readFileSync } from "node:fs";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children),
}));

import AboutPage, { metadata } from "../../app/about/page";

const root = `${import.meta.dirname}/../..`;
const html = renderToStaticMarkup(createElement(AboutPage));

describe("About page", () => {
  // The page is public: it must never read the database, so nobody's tips, ideas or names can reach it.
  it("imports nothing that reads data", () => {
    const src = readFileSync(`${root}/app/about/page.tsx`, "utf8");
    const imports = [...src.matchAll(/from\s+"([^"]+)"|import\s+"([^"]+)"/g)].map((m) => m[1] ?? m[2]);
    expect(imports.sort()).toEqual(["../garden/cards/icons", "./about.css", "next", "next/link", "react"]);
  });

  it("is indexable, with its own title", () => {
    expect(metadata.title).toBe("About Earmark");
    expect(metadata.robots).toEqual({ index: true, follow: true });
  });

  it("carries the attributions each data source requires", () => {
    expect(html).toContain('href="https://www.openstreetmap.org/copyright"');
    expect(html).toContain("© OpenStreetMap contributors");
    expect(html).toContain("courtesy of iTunes");
    expect(html).toContain("Data provided by <a");
    expect(html).toContain("is not affiliated with, sponsored or endorsed by Discogs. ‘Discogs’ is a trademark of Zink Media, LLC.");
    expect(html).toContain("This website uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.");
    expect(html).toContain('src="/tmdb-alt-short-blue.svg"');
    expect(existsSync(`${root}/public/tmdb-alt-short-blue.svg`)).toBe(true);
    expect(html).toContain("Where to watch data by <a"); // TMDB's terms for its watch providers: credit JustWatch
    for (const site of ["musicbrainz.org", "coverartarchive.org", "nominatim.org", "openlibrary.org", "wikipedia.org", "youtube.com", "themoviedb.org", "justwatch.com"]) {
      expect(html).toContain(site);
    }
  });

  it("links to the repo and its decision log", () => {
    expect(html).toContain('href="https://github.com/tmoody1973/earmark"');
    expect(html).toContain('href="https://github.com/tmoody1973/earmark/tree/main/docs/decisions"');
  });
});
