// Routes inject Next's after() as `defer`; nothing under agent/ may import next/* (the eve build loads it outside Next).
export type Defer = (work: () => Promise<void>) => void;

// No defer injected: still run the work (fire and forget), never drop it silently, never throw. Logs err.name only.
export function deferOrRun(defer: Defer | undefined, work: () => Promise<void>): void {
  if (defer) return defer(work);
  void work().catch((e) => console.error(`[capture] deferred work failed err=${e instanceof Error ? e.name : "unknown"}`));
}

// What runs after a capture is saved (the route schedules it with Next's after(), so the 201 never waits on it).
// Deliberate seam: the rec lane (enrich -> summary -> playlist -> Notion) is another lane's work. When it lands,
// replace the log line with `await runRecLane(recId)`; nothing else here or in the routes changes.
export async function afterCaptureSaved(recId: number): Promise<void> {
  console.log(`[capture] rec lane pending recId=${recId}`);
}
