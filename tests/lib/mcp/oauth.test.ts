import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { issueServiceToken, mcpConfigured, mcpResourceUrl, verifyServiceToken } from "../../../agent/lib/mcp/oauth";

const basic = (id: string, secret: string) => `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
const GOOD = basic("earmark-alexa", "s".repeat(40));
const RES = "https://earmark.test/api/mcp";
const req = () => new Request(RES);

beforeEach(() => {
  process.env.EARMARK_PUBLIC_BASE_URL = "https://earmark.test";
  process.env.EARMARK_MCP_CLIENT_ID = "earmark-alexa";
  process.env.EARMARK_MCP_CLIENT_SECRET = "s".repeat(40);
  process.env.EARMARK_MCP_JWT_SECRET = "j".repeat(40);
});
afterEach(() => vi.useRealTimers());

describe("service tokens", () => {
  it("issues a 1h mcp:service bearer token for the MCP resource and verifies it", async () => {
    const t = await issueServiceToken({ authorization: GOOD, resource: RES });
    expect(t).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "mcp:service" });
    expect(t).not.toHaveProperty("refresh_token");
    const info = await verifyServiceToken(req(), t.access_token);
    expect(info).toMatchObject({ clientId: "earmark-alexa", scopes: ["mcp:service"] });
  });
  it("defaults the resource to the MCP URL when none is sent", async () => {
    const t = await issueServiceToken({ authorization: GOOD, resource: null });
    expect(await verifyServiceToken(req(), t.access_token)).toBeDefined();
    expect(mcpResourceUrl()).toBe(RES);
  });
  it("rejects a wrong secret, a wrong id, and malformed credentials", async () => {
    for (const authorization of [basic("earmark-alexa", "nope"), basic("someone", "s".repeat(40)), "Basic !!!", "Bearer x", null, basic("earmark-alexa", "")]) {
      await expect(issueServiceToken({ authorization, resource: RES })).rejects.toThrow("invalid_client");
    }
  });
  it("rejects a token minted for another resource", async () => {
    await expect(issueServiceToken({ authorization: GOOD, resource: "https://evil.test/mcp" })).rejects.toThrow("invalid_target");
  });
  it("does not verify garbage, a missing token, or a token signed with another key", async () => {
    expect(await verifyServiceToken(req(), "abc")).toBeUndefined();
    expect(await verifyServiceToken(req())).toBeUndefined();
    const t = await issueServiceToken({ authorization: GOOD, resource: RES });
    process.env.EARMARK_MCP_JWT_SECRET = "k".repeat(40);
    expect(await verifyServiceToken(req(), t.access_token)).toBeUndefined();
  });
  it("stops verifying after the 1h lifetime", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t = await issueServiceToken({ authorization: GOOD, resource: RES });
    vi.setSystemTime(Date.now() + 3599_000);
    expect(await verifyServiceToken(req(), t.access_token)).toBeDefined();
    vi.setSystemTime(Date.now() + 2_000);
    expect(await verifyServiceToken(req(), t.access_token)).toBeUndefined();
  });
  it("fails closed when any MCP env var is missing or too short", async () => {
    const t = await issueServiceToken({ authorization: GOOD, resource: RES });
    for (const name of ["EARMARK_PUBLIC_BASE_URL", "EARMARK_MCP_CLIENT_ID", "EARMARK_MCP_CLIENT_SECRET", "EARMARK_MCP_JWT_SECRET"]) {
      const saved = process.env[name];
      delete process.env[name];
      expect(mcpConfigured()).toBe(false);
      await expect(issueServiceToken({ authorization: GOOD, resource: RES })).rejects.toThrow("not_configured");
      expect(await verifyServiceToken(req(), t.access_token)).toBeUndefined();
      process.env[name] = saved;
    }
    process.env.EARMARK_MCP_JWT_SECRET = "short";
    expect(mcpConfigured()).toBe(false);
  });
});
