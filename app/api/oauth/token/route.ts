import { issueServiceToken, mcpConfigured } from "@/agent/lib/mcp/oauth";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4096;
const NO_STORE = { "cache-control": "no-store", pragma: "no-cache" };
const err = (error: string, status: number, extra: Record<string, string> = {}) =>
  Response.json({ error }, { status, headers: { ...NO_STORE, ...extra } });

// OAuth client-credentials token endpoint (Alexa+ Tier 1: HTTP Basic client auth, no refresh token).
export async function POST(req: Request): Promise<Response> {
  if (!mcpConfigured()) return new Response(null, { status: 503, headers: NO_STORE });
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return err("invalid_request", 413);
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return err("invalid_request", 413);
  const form = new URLSearchParams(raw);
  if (form.get("grant_type") !== "client_credentials") return err("unsupported_grant_type", 400);
  try {
    const token = await issueServiceToken({ authorization: req.headers.get("authorization"), resource: form.get("resource") });
    return Response.json(token, { headers: NO_STORE });
  } catch (e) {
    const code = e instanceof Error ? e.message : "";
    if (code === "invalid_client") return err("invalid_client", 401, { "www-authenticate": 'Basic realm="earmark"' });
    if (code === "invalid_target") return err("invalid_target", 400);
    console.error(`[mcp] token error=${e instanceof Error ? e.name : "unknown"}`);
    return err("server_error", 500);
  }
}
