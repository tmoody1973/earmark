import { expect, it } from "vitest";
import { newShareToken } from "../../../agent/lib/privacy/tokens";

it("makes 43-char url-safe tokens that do not repeat", () => {
  const a = newShareToken();
  const b = newShareToken();
  expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(a).not.toBe(b);
});
