import { randomBytes } from "node:crypto";

/** 256 bits of randomness, URL-safe (43 chars). Used for receipt cards, published Spaces. */
export function newShareToken(): string {
  return randomBytes(32).toString("base64url");
}
