// What runs after a capture is saved (the route schedules it with Next's after(), so the 201 never waits on it).
// Deliberate seam: the rec lane (enrich -> summary -> playlist -> Notion) is another lane's work. When it lands,
// replace the log line with `await runRecLane(recId)`; nothing else here or in the routes changes.
export async function afterCaptureSaved(recId: number): Promise<void> {
  console.log(`[capture] rec lane pending recId=${recId}`);
}
