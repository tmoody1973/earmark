"use client";
// Minimal live signal (M2-T6): polls the blooms route and announces a bloom in plain words. M4's Impeccable pass
// replaces the presentation (the bloom animation); keep the polite live region.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Ev = { id: number; kind: "mention" | "bloom"; title: string; mentionCount: number };

const POLL_MS = 5_000;

// The newest bloom not announced yet, as a sentence; marks every event seen (polls overlap on purpose).
export function latestBloom(events: readonly Ev[], seen: Set<number>): string | null {
  const fresh = events.filter((e) => !seen.has(e.id));
  for (const e of fresh) seen.add(e.id);
  const bloom = fresh.filter((e) => e.kind === "bloom").at(-1);
  return bloom ? `${bloom.title} bloomed — mentioned ${bloom.mentionCount} times.` : null;
}

export function BloomTicker() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const since = useRef<string | null>(null);
  const seen = useRef(new Set<number>());

  useEffect(() => {
    since.current ??= new Date().toISOString();
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/garden/blooms?since=${encodeURIComponent(since.current!)}`, { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { events: Ev[]; now: string };
        since.current = body.now;
        const hadNew = body.events.some((e) => !seen.current.has(e.id));
        const line = latestBloom(body.events, seen.current);
        if (line) setMessage(line);
        if (hadNew) router.refresh(); // the garden list re-renders with the new counts and stages
      } catch {
        // offline or a deploy in flight: the next poll tries again
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [router]);

  // Always rendered (empty until a bloom) so screen readers already know the live region when text arrives.
  return (
    <p role="status" aria-live="polite" className="bloom-ticker">
      {message}
    </p>
  );
}
