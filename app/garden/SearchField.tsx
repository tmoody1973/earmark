"use client";
import { matchesQuery } from "@/agent/lib/garden/search";
import { Icon } from "./cards/icons";
import { useLive } from "./live";

export interface SearchEntry { key: string; fields: ReadonlyArray<string | null | undefined> }

/**
 * "Search what you heard…": for now it narrows what is on this page by title and first name (matchesQuery).
 * SEAM (M5-T8): memory-cue search swaps the matcher for a server query; this field and its status line stay.
 */
export function SearchField({ index }: { index: readonly SearchEntry[] }) {
  const live = useLive();
  if (!live) return null;
  const { query, setQuery } = live;
  const q = query.trim();
  const hits = q ? new Set(index.filter((e) => matchesQuery(q, e.fields)).map((e) => e.key)).size : 0;
  return (
    <search className="garden-search">
      <label htmlFor="garden-q" className="visually-hidden">Search what you heard</label>
      <Icon name="search" size={20} className="garden-search-icon" />
      <input
        id="garden-q"
        type="search"
        placeholder="Search what you heard…"
        autoComplete="off"
        enterKeyHint="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-describedby="garden-q-status"
      />
      <p id="garden-q-status" className="garden-search-status" aria-live="polite">
        {q ? (hits ? `${hits} on this page` : `Nothing here matches “${q}”.`) : ""}
      </p>
    </search>
  );
}
