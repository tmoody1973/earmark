import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { isOwner } from "@/agent/lib/owner";
import { GARDEN_EVENTS_LIMIT, latestTipChangeSince, listGardenEventsSince } from "@/agent/lib/store/garden-events";

const Since = z.iso.datetime({ offset: true });

// A save stamps its events at transaction start and commits a moment later, so a poll can miss an event committed
// just after it read. `now` is held back by this much: the next poll re-reads that overlap and the ticker dedupes by id.
const OVERLAP_MS = 10_000;

// GET /api/garden/blooms?since=ISO → { events, now, tipsAt }: garden events after `since`, for the live ticker (M4 animates
// from it). Owner only: 404 for anyone else, like the garden page (proxy.ts also gates it; checked here so the route
// is safe on its own).
export async function GET(request: Request): Promise<Response> {
  const { userId } = await auth();
  if (!isOwner(userId)) return Response.json({ error: "not found" }, { status: 404 });
  const since = Since.safeParse(new URL(request.url).searchParams.get("since"));
  if (!since.success) return Response.json({ error: "since must be an ISO date-time" }, { status: 400 });
  const heldBack = new Date(Date.now() - OVERLAP_MS).toISOString(); // taken before the query so no event falls between polls
  const [events, tipsAt] = await Promise.all([listGardenEventsSince(new Date(since.data), GARDEN_EVENTS_LIMIT),
    latestTipChangeSince(new Date(since.data))]);
  // A full page may stop mid-backlog: continue just before its last event (1 ms earlier, so events sharing that
  // timestamp — one save's — are re-read rather than skipped; the ticker dedupes by id).
  const last = events.at(-1);
  const now = events.length >= GARDEN_EVENTS_LIMIT && last ? new Date(Date.parse(last.createdAt) - 1).toISOString() : heldBack;
  return Response.json({ events, now, tipsAt }, { headers: { "cache-control": "no-store" } });
}
