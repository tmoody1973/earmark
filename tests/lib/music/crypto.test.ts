import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken } from "../../../agent/lib/music/crypto";

const key = randomBytes(32).toString("base64");

describe("music token crypto (decision 065)", () => {
  it("round-trips and never stores the plain token", () => {
    const blob = encryptToken("music-user-token-abc", key);
    expect(blob).not.toContain("music-user-token-abc");
    expect(decryptToken(blob, key)).toBe("music-user-token-abc");
  });
  it("encrypts the same token differently each time (fresh iv)", () => {
    expect(encryptToken("same", key)).not.toBe(encryptToken("same", key));
  });
  it("rejects a tampered blob", () => {
    const [iv, tag, enc] = encryptToken("secret", key).split(".");
    const flipped = Buffer.from(enc!, "base64");
    flipped[0]! ^= 1;
    expect(() => decryptToken([iv, tag, flipped.toString("base64")].join("."), key)).toThrow();
  });
  it("rejects the wrong key and a malformed blob", () => {
    const blob = encryptToken("secret", key);
    expect(() => decryptToken(blob, randomBytes(32).toString("base64"))).toThrow();
    expect(() => decryptToken("revoked", key)).toThrow();
  });
  it("rejects a key that is not 32 bytes, or none", () => {
    expect(() => encryptToken("x", Buffer.from("short").toString("base64"))).toThrow(/32 bytes/);
    expect(() => encryptToken("x", "")).toThrow(/MUSIC_TOKEN_KEY/);
  });
});
