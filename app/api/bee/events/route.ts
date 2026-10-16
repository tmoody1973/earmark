import { after } from "next/server";
import { getEnv } from "@/agent/lib/env";
import { handleRelayRequest } from "@/agent/lib/bee/webhook";
import { handleBeeEvent } from "@/agent/lib/pipeline/ingest";

// Production ingress for the Bee relay (F-06: withEve only forwards /eve/v1/**, so the eve channel route of the same
// name is unreachable on Vercel; agent/channels/bee.ts stays for `pnpm dev:agent`). Same handler, same behavior.
// The response acks fast; triage and saving run in after(), which keeps the function alive until the work settles.
// Auth is the shared webhook secret (?key=): proxy.ts lets /api/bee/ past Clerk, so this check is the only gate.
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  return handleRelayRequest(request, {
    secret: getEnv().EARMARK_WEBHOOK_SECRET,
    waitUntil: (p) => after(p),
    handle: (evt) => handleBeeEvent(evt),
  });
}
