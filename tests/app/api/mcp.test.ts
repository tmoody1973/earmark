import { beforeAll, describe, expect, it, vi } from "vitest";

const tools = vi.hoisted(() => ({
  whatDidTheyRecommend: vi.fn(async () => ({ text: "Ann recommended 1 thing: Ramen (place)." })),
  readyIdeas: vi.fn(async () => ({ text: "No ideas are ready yet." })),
  searchEarmarksTool: vi.fn(async () => ({ text: "Nothing matched those clues." })),
  addToEarmarkedPlaylist: vi.fn(async () => ({ text: "x" })),
  latestEpisode: vi.fn(async () => ({ text: "x" })),
}));
vi.mock("../../../agent/lib/mcp/tools", () => tools);
import { SignJWT } from "jose";
import { issueServiceToken } from "../../../agent/lib/mcp/oauth";
import { GET, POST } from "../../../app/api/mcp/route";
import { POST as TOKEN } from "../../../app/api/oauth/token/route";
import { GET as AS_META } from "../../../app/.well-known/oauth-authorization-server/route";
import { GET as PR_META } from "../../../app/.well-known/oauth-protected-resource/route";

const URL_ = "https://earmark.test/api/mcp";
const basic = `Basic ${Buffer.from(`earmark-alexa:${"s".repeat(40)}`).toString("base64")}`;
const rpc = (body: unknown, token?: string) => new Request(URL_, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
});
// Streamable HTTP may answer as an SSE frame ("event: message\ndata: {...}") or plain JSON.
const body = async (res: Response) => { const t = await res.text(); return JSON.parse(t.startsWith("{") ? t : t.split("\n").find((l) => l.startsWith("data:"))!.slice(5)); };
const list = { jsonrpc: "2.0", id: 1, method: "tools/list" };
const form = (body: string, headers: Record<string, string> = { authorization: basic }) =>
  new Request("https://earmark.test/api/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...headers }, body });

beforeAll(() => {
  process.env.EARMARK_PUBLIC_BASE_URL = "https://earmark.test";
  process.env.EARMARK_MCP_CLIENT_ID = "earmark-alexa";
  process.env.EARMARK_MCP_CLIENT_SECRET = "s".repeat(40);
  process.env.EARMARK_MCP_JWT_SECRET = "j".repeat(40);
});

describe("/api/mcp", () => {
  it("answers 401 with a WWW-Authenticate challenge pointing at the resource metadata when unauthenticated", async () => {
    const res = await POST(rpc(list));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("https://earmark.test/.well-known/oauth-protected-resource");
  });
  it("rejects a garbage token and an expired token signed with the real key", async () => {
    expect((await POST(rpc(list, "abc.def.ghi"))).status).toBe(401);
    const past = Math.floor(Date.now() / 1000) - 60;
    const expired = await new SignJWT({ scope: "mcp:service" }).setProtectedHeader({ alg: "HS256" }).setSubject("earmark-alexa")
      .setAudience(URL_).setIssuer("https://earmark.test").setIssuedAt(past - 3600).setExpirationTime(past)
      .sign(new TextEncoder().encode("j".repeat(40)));
    expect((await POST(rpc(list, expired))).status).toBe(401);
  });
  it("accepts a valid token, lists the five tools, and calls one", async () => {
    const { access_token } = await issueServiceToken({ authorization: basic, resource: URL_ });
    const res = await POST(rpc(list, access_token));
    expect(res.status).toBe(200);
    const names = ((await body(res)) as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name).sort();
    expect(names).toEqual(["add_to_earmarked_playlist", "latest_episode", "ready_ideas", "search_earmarks", "what_did_they_recommend"]);
    const call = await POST(rpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "what_did_they_recommend", arguments: { person: "ann" } } }, access_token));
    expect(call.status).toBe(200);
    expect(JSON.stringify(await body(call))).toContain("Ann recommended 1 thing");
    expect(tools.whatDidTheyRecommend).toHaveBeenCalledWith({ person: "ann", period: "month" });
  });
  it("returns a bare 503 when the MCP env is unset (fails closed)", async () => {
    const saved = process.env.EARMARK_MCP_JWT_SECRET;
    delete process.env.EARMARK_MCP_JWT_SECRET;
    const res = await POST(rpc(list, "anything"));
    process.env.EARMARK_MCP_JWT_SECRET = saved;
    expect(res.status).toBe(503);
    expect(await res.text()).toBe("");
  });
  it("answers GET without a token with 401 too", async () => {
    expect((await GET(new Request(URL_))).status).toBe(401);
  });
});

describe("/api/oauth/token", () => {
  it("issues a token for client_credentials", async () => {
    const res = await TOKEN(form(`grant_type=client_credentials&resource=${encodeURIComponent(URL_)}&scope=mcp:service`));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "mcp:service" });
  });
  it("refuses other grants, wrong secrets, other resources and oversize bodies", async () => {
    expect((await TOKEN(form("grant_type=authorization_code"))).status).toBe(400);
    const bad = await TOKEN(form("grant_type=client_credentials", { authorization: "Basic eDp5" }));
    expect(bad.status).toBe(401);
    expect(await bad.json()).toEqual({ error: "invalid_client" });
    expect((await TOKEN(form("grant_type=client_credentials&resource=https%3A%2F%2Fevil.test%2Fmcp"))).status).toBe(400);
    expect((await TOKEN(form(`grant_type=client_credentials&x=${"a".repeat(5000)}`))).status).toBe(413);
  });
  it("fails closed with a bare 503 when unconfigured", async () => {
    const saved = process.env.EARMARK_MCP_CLIENT_SECRET;
    delete process.env.EARMARK_MCP_CLIENT_SECRET;
    const res = await TOKEN(form("grant_type=client_credentials"));
    process.env.EARMARK_MCP_CLIENT_SECRET = saved;
    expect(res.status).toBe(503);
  });
});

describe(".well-known", () => {
  it("publishes protected-resource and authorization-server metadata", async () => {
    expect(await PR_META().json()).toMatchObject({ resource: URL_, authorization_servers: ["https://earmark.test"], scopes_supported: ["mcp:service"] });
    expect(await AS_META().json()).toMatchObject({ issuer: "https://earmark.test", token_endpoint: "https://earmark.test/api/oauth/token", grant_types_supported: ["client_credentials"] });
  });
  it("is 503 when unconfigured", async () => {
    const saved = process.env.EARMARK_PUBLIC_BASE_URL;
    delete process.env.EARMARK_PUBLIC_BASE_URL;
    expect(PR_META().status).toBe(503);
    expect(AS_META().status).toBe(503);
    process.env.EARMARK_PUBLIC_BASE_URL = saved;
  });
});
