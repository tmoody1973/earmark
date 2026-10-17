// Mints a 1-hour MCP bearer token from the local client credentials. Prints only the token.
//   pnpm exec tsx --env-file=.env.local scripts/mcp-token.ts
import { issueServiceToken } from "../agent/lib/mcp/oauth";

const id = process.env.EARMARK_MCP_CLIENT_ID ?? "";
const secret = process.env.EARMARK_MCP_CLIENT_SECRET ?? "";
const t = await issueServiceToken({ authorization: `Basic ${Buffer.from(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`).toString("base64")}`, resource: null });
console.log(t.access_token);
