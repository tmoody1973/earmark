"use client";
// The garden's live layer (M4-T4), replacing M2-T6's bloom ticker: one poller per page for GET /api/garden/blooms,
// the plants' live state, bloom chips for the New row, the search query, and the polite live region.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { emptyLive, parseBloomsResponse, pollDelay, reduceFeed, settleBloom, type LiveState, type PlantPatch } from "@/agent/lib/garden/live";
import type { PlantLevel } from "@/agent/lib/garden/plant";
import { matchesQuery } from "@/agent/lib/garden/search";

interface LiveApi {
  live: LiveState;
  query: string;
  setQuery: (q: string) => void;
  settle: (clusterId: number) => void;
}

const LiveContext = createContext<LiveApi | null>(null);

/** The live state; null outside the home page (the Garden and Shelf tabs are not live). */
export const useLive = () => useContext(LiveContext);

export function usePlantPatch(clusterId: number): PlantPatch | undefined {
  return useLive()?.live.patches[clusterId];
}

/** A list item the search field can hide. `fields`: what it is found by (titles and first names). */
export function Findable({ fields, children }: { fields: ReadonlyArray<string | null | undefined>; children: React.ReactNode }) {
  const query = useLive()?.query ?? "";
  return <li hidden={!matchesQuery(query, fields)}>{children}</li>;
}

export interface GardenLiveProps {
  /** Server time taken before the page's reads: anything saved after it reaches the page through the poller. */
  initialSince: string;
  /** Plants drawn on the page and the level the server drew each at. */
  onPage: ReadonlyArray<readonly [number, PlantLevel]>;
  children: React.ReactNode;
}

export function GardenLive({ initialSince, onPage, children }: GardenLiveProps) {
  const router = useRouter();
  const [live, setLive] = useState(emptyLive);
  const [query, setQuery] = useState("");
  const state = useRef(live);
  const since = useRef(initialSince);
  const drawn = useRef<ReadonlyMap<number, PlantLevel>>(new Map(onPage));

  useEffect(() => {
    drawn.current = new Map(onPage); // a refresh redraws the bed
  }, [onPage]);

  const commit = useCallback((next: LiveState) => {
    if (next === state.current) return;
    state.current = next;
    setLive(next);
  }, []);
  const settle = useCallback((clusterId: number) => commit(settleBloom(state.current, clusterId)), [commit]);

  useEffect(() => {
    let timer: number | undefined;
    let failures = 0;
    let inFlight = false;
    let stopped = false;
    const ctrl = new AbortController();

    // One timer at a time, and none while the tab is hidden (visibilitychange restarts it).
    const schedule = (ms: number) => {
      window.clearTimeout(timer);
      if (!stopped && document.visibilityState === "visible") timer = window.setTimeout(tick, ms);
    };

    async function tick() {
      if (inFlight) return; // the poll in flight schedules the next one
      inFlight = true;
      try {
        const res = await fetch(`/api/garden/blooms?since=${encodeURIComponent(since.current)}`, { cache: "no-store", signal: ctrl.signal });
        if (!res.ok) throw new Error(`blooms ${res.status}`);
        const data = parseBloomsResponse(await res.json());
        since.current = data.now;
        const r = reduceFeed(state.current, data.events, drawn.current);
        commit(r.state);
        if (r.refresh) router.refresh();
        failures = 0;
      } catch (err) {
        if (stopped) return;
        failures += 1; // back off: 10 s, 20 s, 40 s, then once a minute
        console.error("[bloom] poll failed", err instanceof Error ? err.name : typeof err); // never the message (amendment c)
      } finally {
        inFlight = false;
      }
      schedule(pollDelay(failures));
    }

    const onVisibility = () => (document.visibilityState === "visible" ? schedule(0) : window.clearTimeout(timer));
    document.addEventListener("visibilitychange", onVisibility);
    schedule(pollDelay(0));
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      ctrl.abort();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [router, commit]);

  const api = useMemo(() => ({ live, query, setQuery, settle }), [live, query, settle]);
  return (
    <LiveContext value={api}>
      {children}
      {/* Always rendered, so screen readers know the region before the first bloom arrives. */}
      <p className="visually-hidden" role="status" aria-live="polite" data-testid="bloom-announcer">
        {live.announcement}
      </p>
    </LiveContext>
  );
}
