import { mcpConfigured, mcpIssuer, mcpResourceUrl } from "@/agent/lib/mcp/oauth";

export const dynamic = "force-dynamic"; // reads env per request: never prerender at build

// RFC 9728 Protected Resource Metadata.
export function GET() {
  if (!mcpConfigured()) return new Response(null, { status: 503 });
  return Response.json({
    resource: mcpResourceUrl(),
    authorization_servers: [mcpIssuer()],
    scopes_supported: ["mcp:service"],
    bearer_methods_supported: ["header"],
  });
}
