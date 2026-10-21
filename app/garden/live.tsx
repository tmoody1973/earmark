"use client";
// The garden's live layer (M4-T4), replacing M2-T6's bloom ticker: one poller per page for GET /api/garden/blooms,
// the plants' live state, bloom chips for the New row, the search query, visits, and the polite live region.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  emptyLive, isBlooming, newTipsSince, parseBloomsResponse, reduceFeed, settleBloom, type DrawnPlant, type LiveState, type PlantPatch,
} from "@/agent/lib/garden/live";
import { matchesQuery } from "@/agent/lib/garden/search";
import { recordGardenVisit } from "./actions";
import { startPoller } from "./poller";

interface LiveApi {
  live: LiveState;
  query: string;
  setQuery: (q: string) => void;
  settle: (clusterId: number) => void;
  /** The bed's order when this visit began (stableOrder): live refreshes never re-sort what he is looking at. */
  shown: readonly number[];
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

const errName = (err: unknown) => (err instanceof Error ? err.name : typeof err); // never the message (amendment c)

export interface GardenLiveProps {
  /** Server time taken before the page's reads: anything saved after it reaches the page through the poller. */
  initialSince: string;
  /** Plants drawn on the page, in the server's order, and how each is drawn. */
  onPage: ReadonlyArray<readonly [number, DrawnPlant]>;
  /** false in the judge demo (decision 053): a look is a write, and the demo refuses writes. */
  recordsVisits?: boolean;
  children: React.ReactNode;
}

export function GardenLive({ initialSince, onPage, recordsVisits = true, children }: GardenLiveProps) {
  const router = useRouter();
  const [live, setLive] = useState(emptyLive);
  const [query, setQuery] = useState("");
  const [shown] = useState(() => onPage.map(([id]) => id));
  const state = useRef(live);
  const since = useRef(initialSince);
  const tipsSeen = useRef(initialSince); // the page was drawn with every tip up to here
  const drawn = useRef<ReadonlyMap<number, DrawnPlant>>(new Map(onPage));
  const refreshWaiting = useRef(false);

  useEffect(() => {
    drawn.current = new Map(onPage); // a refresh redraws the bed
  }, [onPage]);

  const commit = useCallback((next: LiveState) => {
    if (next === state.current) return;
    state.current = next;
    setLive(next);
  }, []);

  // Refreshes wait for any bloom in progress: the server's new order would move the plant mid-bloom.
  const refresh = useCallback(() => {
    if (isBlooming(state.current)) refreshWaiting.current = true;
    else router.refresh();
  }, [router]);

  const settle = useCallback((clusterId: number) => {
    commit(settleBloom(state.current, clusterId));
    if (refreshWaiting.current && !isBlooming(state.current)) {
      refreshWaiting.current = false;
      router.refresh();
    }
  }, [commit, router]);

  // A look is recorded when the page mounts and when he comes back to the tab, never by a render or refresh.
  // Back after the 30-minute gap is a new visit: a fresh page (new baseline, new order, clean live state).
  useEffect(() => {
    if (!recordsVisits) return;
    const record = (onReturn: boolean) =>
      recordGardenVisit()
        .then(({ started }) => { if (started && onReturn) window.location.reload(); })
        .catch((err) => console.error("[garden] visit not recorded", errName(err)));
    void record(false);
    const onVisibility = () => { if (document.visibilityState === "visible") void record(true); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [recordsVisits]);

  useEffect(() => {
    const poller = startPoller({
      isVisible: () => document.visibilityState === "visible",
      onError: (err) => console.error("[bloom] poll failed", errName(err)),
      poll: async (signal) => {
        const res = await fetch(`/api/garden/blooms?since=${encodeURIComponent(since.current)}`, { cache: "no-store", signal });
        if (!res.ok) throw new Error(`blooms ${res.status}`);
        const data = parseBloomsResponse(await res.json());
        since.current = data.now;
        const r = reduceFeed(state.current, data.events, drawn.current);
        commit(r.state);
        const tips = newTipsSince(tipsSeen.current, data.tipsAt);
        if (tips) tipsSeen.current = data.tipsAt!;
        if (r.refresh || tips) refresh(); // a new tip, or its cover art or map arriving, redraws Home
      },
    });
    document.addEventListener("visibilitychange", poller.visibilityChanged);
    return () => {
      poller.stop();
      document.removeEventListener("visibilitychange", poller.visibilityChanged);
    };
  }, [commit, refresh]);

  const api = useMemo(() => ({ live, query, setQuery, settle, shown }), [live, query, settle, shown]);
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
