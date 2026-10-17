"use client";
import { useEffect, useState } from "react";
import { matchesQuery } from "@/agent/lib/garden/search";
import { Icon } from "./cards/icons";
import { useLive } from "./live";

const STATUS_DEBOUNCE_MS = 400;

export interface SearchEntry { key: string; fields: ReadonlyArray<string | null | undefined> }

/**
 * "Search what you heard…": typing narrows what is on this page by title and first name (matchesQuery);
 * Enter asks memory-cue search (/search) to look through everything Earmark heard.
 */
export function SearchField({ index }: { index: readonly SearchEntry[] }) {
  const live = useLive();
  const query = live?.query ?? "";
  // The list filters as he types; the spoken status waits for a pause, so a screen reader is not read every letter.
  const [settled, setSettled] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => setSettled(query.trim()), STATUS_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [query]);
  if (!live) return null;
  const { setQuery } = live;
  const q = settled;
  const hits = q ? new Set(index.filter((e) => matchesQuery(q, e.fields)).map((e) => e.key)).size : 0;
  return (
    <search className="garden-search">
      <form action="/search" method="get">
        <label htmlFor="garden-q" className="visually-hidden">Search what you heard</label>
        <Icon name="search" size={20} className="garden-search-icon" />
        <input
          id="garden-q"
          name="q"
          type="search"
          placeholder="Search what you heard…"
          autoComplete="off"
          enterKeyHint="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-describedby="garden-q-status"
        />
        <p id="garden-q-status" className="garden-search-status" aria-live="polite">
          {q ? `${hits ? `${hits} on this page.` : `Nothing here matches “${q}”.`} Press Enter to search everything.` : ""}
        </p>
      </form>
    </search>
  );
}
