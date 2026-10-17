import { createHash, createPrivateKey, sign } from "node:crypto";

// Apple Music developer token: an ES256 JWT, header {alg, kid}, claims {iss, iat, exp}; exp ≤ 6 months.
// Source: https://developer.apple.com/documentation/applemusicapi/generating-developer-tokens (docs/research/integrations.md §1).
// ponytail: signed with node:crypto (ieee-p1363 = the raw r||s signature JWS wants) instead of adding jose.

export interface AppleMusicConfig { teamId: string; keyId: string; privateKey: string; storefront: string }

// Optional: Apple Music is an add-on provider. Null unless all three secrets are set (then it is skipped, never an error).
export function appleMusicConfig(source: Record<string, string | undefined> = process.env): AppleMusicConfig | null {
  const teamId = source.APPLE_TEAM_ID?.trim();
  const keyId = source.APPLE_MUSIC_KEY_ID?.trim();
  const privateKey = source.APPLE_MUSIC_PRIVATE_KEY?.trim();
  if (!teamId || !keyId || !privateKey) return null;
  return { teamId, keyId, privateKey, storefront: source.APPLE_MUSIC_STOREFRONT?.trim() || "us" };
}

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
let cached: { token: string; exp: number; id: string } | undefined;

export async function getDeveloperToken(
  cfg: Pick<AppleMusicConfig, "teamId" | "keyId" | "privateKey">,
  nowMs: number = Date.now(),
): Promise<string> {
  const iat = Math.floor(nowMs / 1000);
  // A rotated key or another team must never get the old token: the cache key covers all three inputs.
  const id = `${cfg.teamId}:${cfg.keyId}:${createHash("sha256").update(cfg.privateKey).digest("hex")}`;
  if (cached && cached.id === id && cached.exp - 3600 > iat) return cached.token;
  const exp = iat + 12 * 3600; // Apple allows up to 6 months; short-lived is safer
  const signingInput = `${b64({ alg: "ES256", kid: cfg.keyId })}.${b64({ iss: cfg.teamId, iat, exp })}`;
  const key = createPrivateKey(cfg.privateKey.replace(/\\n/g, "\n")); // env stores the .p8 with literal \n
  const signature = sign("sha256", Buffer.from(signingInput), { key, dsaEncoding: "ieee-p1363" }).toString("base64url");
  const token = `${signingInput}.${signature}`;
  cached = { token, exp, id };
  return token;
}
