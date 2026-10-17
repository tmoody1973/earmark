import { mcpConfigured, mcpIssuer } from "@/agent/lib/mcp/oauth";

export const dynamic = "force-dynamic"; // reads env per request: never prerender at build

// RFC 8414 metadata. No authorization endpoint: Earmark only does client_credentials.
export function GET() {
  if (!mcpConfigured()) return new Response(null, { status: 503 });
  const base = mcpIssuer();
  return Response.json({
    issuer: base,
    token_endpoint: `${base}/api/oauth/token`,
    grant_types_supported: ["client_credentials"],
    token_endpoint_auth_methods_supported: ["client_secret_basic"],
    scopes_supported: ["mcp:service"],
    response_types_supported: [],
  });
}
