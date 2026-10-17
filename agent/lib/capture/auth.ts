import { timingSafeEqual } from "node:crypto";

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function bearerMatches(req: Request, expected: string): boolean {
  const got = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return got.length > 0 && safeEqual(got, expected);
}
