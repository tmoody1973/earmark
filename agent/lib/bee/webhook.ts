import { createHash, timingSafeEqual } from "node:crypto";
import { BeeEventSchema, type BeeEvent } from "./events";

const digest = (s: string) => createHash("sha256").update(s).digest();

export function secretMatches(given: string | null, expected: string): boolean {
  if (!given) return false;
  return timingSafeEqual(digest(given), digest(expected)); // equal-length digests, constant time
}

// The relay's secret travels in a header (never the URL, which lands in access logs): `x-earmark-key: <secret>` or
// `Authorization: Bearer <secret>`.
export function presentedSecret(request: Request): string | null {
  const bearer = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "");
  return request.headers.get("x-earmark-key") ?? bearer?.[1] ?? null;
}

// Structure only (keys + value types, arrays as [elementType]); never values, so it is safe to log.
// Capped (depth 4, 20 keys per object, 300 chars), id-like keys redacted, and it can never throw.
const MAX_DEPTH = 4, MAX_KEYS = 20, MAX_LEN = 300;
const ID_KEY = /^\d+$|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function walk(v: unknown, depth: number): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return v.length ? (depth >= MAX_DEPTH ? "[…]" : `[${walk(v[0], depth + 1)}]`) : "[]";
  if (typeof v === "object") {
    if (depth >= MAX_DEPTH) return "{…}";
    const entries = Object.entries(v);
    const parts = entries.slice(0, MAX_KEYS).map(([k, x]) => `${ID_KEY.test(k) ? "<id>" : k}:${walk(x, depth + 1)}`);
    if (entries.length > MAX_KEYS) parts.push("…");
    return `{${parts.join(",")}}`;
  }
  return typeof v;
}

export function shapeOf(v: unknown): string {
  try {
    const out = walk(v, 0);
    return out.length > MAX_LEN ? `${out.slice(0, MAX_LEN)}…` : out;
  } catch {
    return "<unshapeable>";
  }
}

/** Event names are logged only when well-formed; anything else (could be text) is reduced to its type. */
export function eventLabel(v: unknown): string {
  return typeof v === "string" && /^[a-z-]{1,40}$/.test(v) ? v : typeof v;
}

export async function handleRelayRequest(
  request: Request,
  opts: { secret: string; waitUntil: (p: Promise<unknown>) => void; handle: (evt: BeeEvent) => Promise<void> },
): Promise<Response> {
  if (!secretMatches(presentedSecret(request), opts.secret)) {
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
    const name = eventLabel(typeof body === "object" && body !== null && "event" in body ? body.event : undefined);
    console.warn(`[bee] unrecognized event: ${name} shape=${shapeOf(body)}`);
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
