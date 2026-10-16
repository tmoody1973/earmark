import { createHash, timingSafeEqual } from "node:crypto";
import { BeeEventSchema, type BeeEvent } from "./events";

const digest = (s: string) => createHash("sha256").update(s).digest();

export function secretMatches(given: string | null, expected: string): boolean {
  if (!given) return false;
  return timingSafeEqual(digest(given), digest(expected)); // equal-length digests, constant time
}

export async function handleRelayRequest(
  request: Request,
  opts: { secret: string; waitUntil: (p: Promise<unknown>) => void; handle: (evt: BeeEvent) => Promise<void> },
): Promise<Response> {
  if (!secretMatches(new URL(request.url).searchParams.get("key"), opts.secret)) {
    return Response.json({ ok: false }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const parsed = BeeEventSchema.safeParse(body);
  if (!parsed.success) {
    const name = typeof body === "object" && body !== null && "event" in body ? String(body.event) : "?";
    console.warn(`[bee] unrecognized event: ${name}`);
    return Response.json({ ok: false, error: "unrecognized event" }, { status: 400 });
  }
  const evt = parsed.data;
  // async wrapper: a synchronous throw from handle is also caught and logged, never surfaced to the response.
  // Error name only: messages can echo transcript text.
  opts.waitUntil(
    (async () => opts.handle(evt))().catch((err: unknown) =>
      console.error(`[bee] ${evt.event} failed error=${err instanceof Error ? err.name : "unknown"}`),
    ),
  );
  return Response.json({ ok: true });
}
