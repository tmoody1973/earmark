import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { isOwner } from "@/agent/lib/owner";
import { listGardenEventsSince } from "@/agent/lib/store/garden-events";

const Since = z.iso.datetime({ offset: true });

// A save stamps its events at transaction start and commits a moment later, so a poll can miss an event committed
// just after it read. `now` is held back by this much: the next poll re-reads that overlap and the ticker dedupes by id.
const OVERLAP_MS = 10_000;

// GET /api/garden/blooms?since=ISO → { events, now }: garden events after `since`, for the live ticker (M4 animates
// from it). Owner only: 404 for anyone else, like the garden page (proxy.ts also gates it; checked here so the route
// is safe on its own).
export async function GET(request: Request): Promise<Response> {
  const { userId } = await auth();
  if (!isOwner(userId)) return Response.json({ error: "not found" }, { status: 404 });
  const since = Since.safeParse(new URL(request.url).searchParams.get("since"));
  if (!since.success) return Response.json({ error: "since must be an ISO date-time" }, { status: 400 });
  const now = new Date(Date.now() - OVERLAP_MS).toISOString(); // taken before the query so no event falls between polls
  const events = await listGardenEventsSince(new Date(since.data));
  return Response.json({ events, now }, { headers: { "cache-control": "no-store" } });
}
