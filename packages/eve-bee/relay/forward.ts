// Reads `bee stream --json` lines on stdin and POSTs each to the Earmark ingress with the secret in a header.
// Why not `bee stream --webhook-endpoint`: the CLI cannot add headers, so the secret would have to ride in the URL.
// Run: node relay/forward.ts (Node 24 strips the types). Env: EARMARK_RELAY_URL, EARMARK_WEBHOOK_SECRET.
// Logs event names, status codes and error names only (never payloads, URLs with secrets, or the secret).
import { createInterface } from "node:readline";

export type Envelope = { event: string; ts: string; data: Record<string, unknown> };

/** One `bee stream --json` line -> the envelope the ingress expects. The first line has no `type`: it is the connect handshake. */
export function toEnvelope(line: string, ts: string): Envelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const { type, ...data } = parsed as Record<string, unknown>;
  return { event: typeof type === "string" ? type : "connected", ts, data };
}

type ForwardOpts = { url: string; secret: string; fetchImpl?: typeof fetch; log?: (msg: string) => void };

export async function forward(line: string, { url, secret, fetchImpl = fetch, log = console.log }: ForwardOpts): Promise<void> {
  const envelope = toEnvelope(line, new Date().toISOString());
  if (!envelope) return;
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-earmark-key": secret },
      body: JSON.stringify(envelope),
      signal: AbortSignal.timeout(30_000),
    });
    log(`[relay] ${envelope.event} -> ${res.status}`);
  } catch (err) {
    log(`[relay] ${envelope.event} failed error=${err instanceof Error ? err.name : "unknown"}`);
  }
}

async function main(): Promise<void> {
  const url = process.env.EARMARK_RELAY_URL;
  const secret = process.env.EARMARK_WEBHOOK_SECRET;
  if (!url || !secret) throw new Error("EARMARK_RELAY_URL and EARMARK_WEBHOOK_SECRET are required");
  // Serial, like the CLI's own webhook: events stay in order. A failed POST is dropped (the 10-minute /v1/changes sync recovers it).
  for await (const line of createInterface({ input: process.stdin })) await forward(line, { url, secret });
}

if (process.argv[1]?.endsWith("forward.ts")) {
  main().catch((err: unknown) => {
    console.error(`[relay] forwarder failed error=${err instanceof Error ? err.name : "unknown"}`);
    process.exit(1);
  });
}
