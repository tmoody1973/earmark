import { afterEach, describe, expect, it, vi } from "vitest";
import { gate, isOwner, isPublicPath } from "../../agent/lib/owner";

afterEach(() => vi.unstubAllEnvs());

describe("isOwner", () => {
  it("is true only for the configured owner", () => {
    expect(isOwner("user_abc", "user_abc")).toBe(true);
    expect(isOwner("user_xyz", "user_abc")).toBe(false);
  });

  it("is false when no owner is configured or nobody is signed in", () => {
    expect(isOwner("user_abc", undefined)).toBe(false);
    expect(isOwner("user_abc", "")).toBe(false);
    expect(isOwner(null, "user_abc")).toBe(false);
    expect(isOwner(undefined, "user_abc")).toBe(false);
  });

  it("reads EARMARK_OWNER_CLERK_ID from the environment by default", () => {
    vi.stubEnv("EARMARK_OWNER_CLERK_ID", "user_env");
    expect(isOwner("user_env")).toBe(true);
    expect(isOwner("user_other")).toBe(false);
  });

  it("is closed when the environment has no owner", () => {
    vi.stubEnv("EARMARK_OWNER_CLERK_ID", "");
    expect(isOwner("user_env")).toBe(false);
  });
});

describe("isPublicPath", () => {
  it.each(["/sign-in", "/sign-in/factor-one", "/sign-out", "/api/bee/events", "/eve/v1/health"])("%s is public", (p) => expect(isPublicPath(p)).toBe(true));
  it.each(["/", "/ideas/3", "/api/other", "/sign-inx", "/sign-outx", "/api/beeper", "/eve/v10"])("%s is private", (p) => expect(isPublicPath(p)).toBe(false));
});

describe("isPublicPath (M5 channels)", () => {
  it.each(["/api/capture/photo", "/api/mcp", "/r/abc", "/s/abc", "/feed/xyz.xml"])("%s is public", (p) => expect(isPublicPath(p)).toBe(true));
  it.each(["/api/captures", "/spaces/1", "/tips/1"])("%s stays private", (p) => expect(isPublicPath(p)).toBe(false));
});

describe("gate (what proxy.ts does with a request)", () => {
  it("lets public paths through for anyone, signed in or not", () => {
    expect(gate("/api/bee/events", null, "user_abc")).toBe("allow");
    expect(gate("/sign-in", "user_xyz", "user_abc")).toBe("allow");
  });

  it("sends a signed-out visitor to sign in", () => {
    expect(gate("/", null, "user_abc")).toBe("sign-in");
  });

  it("lets the owner in", () => {
    expect(gate("/", "user_abc", "user_abc")).toBe("allow");
  });

  it("refuses a signed-in non-owner, and everyone when no owner is configured", () => {
    expect(gate("/", "user_xyz", "user_abc")).toBe("forbid");
    expect(gate("/", "user_abc", undefined)).toBe("forbid");
  });
});
