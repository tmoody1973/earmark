// Service-level OAuth for the MCP server: one client (Tarik's assistant), client_credentials grant, short-lived JWTs.
// Reads process.env directly (like owner.ts) so the public routes need no unrelated vars and fail closed on their own.
import type { AuthInfo } from "@modelcontextprotocol/server";
import { randomUUID } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { safeEqual } from "../capture/auth";

const SCOPE = "mcp:service";
const TTL_SECONDS = 3600; // Alexa+ Tier 1: expires_in must be <= 3600
const MAX_AUTH_HEADER = 1024;

interface McpConfig { baseUrl: string; clientId: string; clientSecret: string; jwtSecret: string }

function config(): McpConfig | null {
  const { EARMARK_PUBLIC_BASE_URL: base, EARMARK_MCP_CLIENT_ID: clientId, EARMARK_MCP_CLIENT_SECRET: clientSecret, EARMARK_MCP_JWT_SECRET: jwtSecret } = process.env;
  if (!base || !clientId || clientId.length < 8 || !clientSecret || clientSecret.length < 32 || !jwtSecret || jwtSecret.length < 32) return null;
  try {
    return { baseUrl: new URL(base).origin, clientId, clientSecret, jwtSecret };
  } catch {
    return null;
  }
}

function need(): McpConfig {
  const c = config();
  if (!c) throw new Error("not_configured");
  return c;
}

/** True when all four MCP env vars are set and well-formed. The routes answer 503 otherwise. */
export const mcpConfigured = (): boolean => config() !== null;
/** The issuer: the production origin. */
export const mcpIssuer = (): string => need().baseUrl;
export const mcpResourceUrl = (): string => `${need().baseUrl}/api/mcp`;

export interface TokenResponse { access_token: string; token_type: "Bearer"; expires_in: number; scope: string }

function basicCredentials(header: string | null): { id: string; secret: string } {
  try {
    if (!header || header.length > MAX_AUTH_HEADER || !/^Basic /i.test(header)) return { id: "", secret: "" };
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const sep = decoded.indexOf(":");
    if (sep <= 0) return { id: "", secret: "" };
    // RFC 6749 2.3.1: id and secret are form-urlencoded before base64.
    return { id: decodeURIComponent(decoded.slice(0, sep)), secret: decodeURIComponent(decoded.slice(sep + 1)) };
  } catch {
    return { id: "", secret: "" };
  }
}

export async function issueServiceToken(input: { authorization: string | null; resource: string | null }): Promise<TokenResponse> {
  const c = need();
  const { id, secret } = basicCredentials(input.authorization);
  const idOk = safeEqual(id, c.clientId);
  const secretOk = safeEqual(secret, c.clientSecret); // both always evaluated
  if (!(idOk && secretOk)) throw new Error("invalid_client");
  const resource = mcpResourceUrl();
  if (input.resource !== null && input.resource.replace(/\/$/, "") !== resource) throw new Error("invalid_target");
  const access_token = await new SignJWT({ scope: SCOPE })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(id)
    .setAudience(resource)
    .setIssuer(c.baseUrl)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(new TextEncoder().encode(c.jwtSecret));
  return { access_token, token_type: "Bearer", expires_in: TTL_SECONDS, scope: SCOPE };
}

export async function verifyServiceToken(_req: Request, token?: string): Promise<AuthInfo | undefined> {
  const c = config();
  if (!token || !c) return undefined;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(c.jwtSecret), {
      algorithms: ["HS256"], audience: `${c.baseUrl}/api/mcp`, issuer: c.baseUrl,
    });
    if (payload.scope !== SCOPE || !payload.sub) return undefined;
    return { token, clientId: payload.sub, scopes: [SCOPE], expiresAt: payload.exp };
  } catch {
    return undefined;
  }
}
