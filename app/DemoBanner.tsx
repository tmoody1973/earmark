"use client";
import { useEffect, useState } from "react";
import { DEMO_BANNER, DEMO_HEADER, DEMO_READ_ONLY } from "@/agent/lib/demo";

/**
 * The judge demo's banner (decision 053), on every page. proxy.ts refuses every write before it runs, marked with
 * DEMO_HEADER; this watches responses for that mark and says so here, where it can be seen. Each control already puts
 * its card back when a save fails, so nothing else on the page needs to know about the demo.
 */
export function DemoBanner() {
  const [said, setSaid] = useState("");
  useEffect(() => {
    const original = window.fetch;
    // ponytail: wraps fetch (server actions and API calls both go through it); reads the response, never changes it.
    const watched = async (...args: Parameters<typeof fetch>) => {
      const res = await original(...args);
      if (res.headers.get(DEMO_HEADER) === "read-only") {
        setSaid(""); // cleared first, so a second refusal is announced again
        requestAnimationFrame(() => setSaid(DEMO_READ_ONLY));
      }
      return res;
    };
    window.fetch = Object.assign(watched, original); // keeps fetch's own properties (e.g. preconnect)
    return () => { window.fetch = original; };
  }, []);
  return (
    <aside className="demo-banner" aria-label="Demo">
      <p>{DEMO_BANNER}</p>
      <p className="demo-said" role="status">{said}</p>
    </aside>
  );
}
