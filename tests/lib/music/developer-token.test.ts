import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { appleMusicConfig, getDeveloperToken } from "../../../agent/lib/music/developer-token";

const part = (token: string, i: number) => JSON.parse(Buffer.from(token.split(".")[i]!, "base64url").toString("utf8"));

describe("getDeveloperToken", () => {
  it("signs an ES256 JWT with kid, iss and a 12h expiry that verifies with the public key", async () => {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const cfg = { teamId: "TEAM123456", keyId: "KEY1234567", privateKey: pem.replace(/\n/g, "\\n") };
    const token = await getDeveloperToken(cfg, 1_800_000_000_000);
    expect(part(token, 0)).toMatchObject({ alg: "ES256", kid: "KEY1234567" });
    const claims = part(token, 1);
    expect(claims.iss).toBe("TEAM123456");
    expect(claims.iat).toBe(1_800_000_000);
    expect(claims.exp - claims.iat).toBe(12 * 3600);
    const [h, p, s] = token.split(".");
    const ok = verify("sha256", Buffer.from(`${h}.${p}`), { key: createPublicKey(privateKey), dsaEncoding: "ieee-p1363" }, Buffer.from(s!, "base64url"));
    expect(ok).toBe(true);
  });
});

describe("getDeveloperToken cache", () => {
  const pem = () => generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  it("reuses a token only for the same team, key id and private key", async () => {
    const a = { teamId: "TEAM000001", keyId: "KEY0000001", privateKey: pem() };
    const t1 = await getDeveloperToken(a, 1_900_000_000_000);
    expect(await getDeveloperToken(a, 1_900_000_000_000)).toBe(t1);
    expect(part(await getDeveloperToken({ ...a, teamId: "TEAM000002" }, 1_900_000_000_000), 1).iss).toBe("TEAM000002");
    const rotated = { ...a, privateKey: pem() };
    const t3 = await getDeveloperToken(rotated, 1_900_000_000_000);
    const [h, p, s] = t3.split(".");
    expect(verify("sha256", Buffer.from(`${h}.${p}`), { key: createPublicKey(rotated.privateKey), dsaEncoding: "ieee-p1363" }, Buffer.from(s!, "base64url"))).toBe(true);
  });
});

describe("appleMusicConfig", () => {
  it("is null unless all three Apple values are set", () => {
    expect(appleMusicConfig({})).toBeNull();
    expect(appleMusicConfig({ APPLE_TEAM_ID: "T", APPLE_MUSIC_KEY_ID: "K" })).toBeNull();
    expect(appleMusicConfig({ APPLE_TEAM_ID: "T", APPLE_MUSIC_KEY_ID: "K", APPLE_MUSIC_PRIVATE_KEY: "P" })).toEqual({
      teamId: "T", keyId: "K", privateKey: "P", storefront: "us",
    });
  });
});
