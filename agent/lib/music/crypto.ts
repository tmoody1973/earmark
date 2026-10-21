import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// The owner's Apple Music User Token at rest (decision 065): AES-256-GCM, blob = iv.tag.ciphertext (base64 parts).
// GCM's tag makes a tampered blob or a wrong key throw instead of decrypting to garbage.
// Key: MUSIC_TOKEN_KEY, 32 random bytes as base64 (`openssl rand -base64 32`).

function key(raw: string | undefined = process.env.MUSIC_TOKEN_KEY): Buffer {
  if (!raw?.trim()) throw new Error("MUSIC_TOKEN_KEY is not set");
  const k = Buffer.from(raw.trim(), "base64");
  if (k.length !== 32) throw new Error("MUSIC_TOKEN_KEY must be 32 bytes, base64 (openssl rand -base64 32)");
  return k;
}

export function encryptToken(plain: string, rawKey?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(rawKey), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}

export function decryptToken(blob: string, rawKey?: string): string {
  const parts = blob.split(".");
  if (parts.length !== 3) throw new Error("not an encrypted music token");
  const [iv, tag, enc] = parts.map((s) => Buffer.from(s, "base64")) as [Buffer, Buffer, Buffer];
  const decipher = createDecipheriv("aes-256-gcm", key(rawKey), iv, { authTagLength: 16 }); // a cut-short tag is refused
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}
