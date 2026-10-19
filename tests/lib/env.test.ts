import { describe, expect, it } from "vitest";
import { getEnv, ownerDisplayName, ownerFirstName } from "../../agent/lib/env";
import { DEFAULT_BEE_API_BASE, DEFAULT_TRIAGE_MODEL } from "../../packages/eve-bee/src/index.ts";

const base = {
  BEE_TOKEN: "bee-token",
  DATABASE_URL: "postgresql://u:p@host/db?sslmode=require",
  EARMARK_WEBHOOK_SECRET: "a".repeat(64),
};

describe("getEnv", () => {
  it("applies defaults for models and the Bee base URL", () => {
    const env = getEnv(base);
    expect(env.BEE_API_BASE).toBe("https://api.developer.bee.amazon.dev");
    expect(env.TRIAGE_MODEL).toBe("typesafe-ai/jev-1.13.0");
    expect(env.BENCHMARK_MODEL).toBe("openai/gpt-6-luna-decisions");
    expect(env.EXTRACT_MODEL).toBe("anthropic/claude-haiku-5.5");
    expect(env.WRITE_MODEL).toBe("anthropic/claude-sonnet-5.5");
    expect(env.EMBED_MODEL).toBe("openai/text-embedding-3-small");
  });

  it("uses the same Bee URL and triage model defaults as the eve-bee package", () => {
    const env = getEnv(base);
    expect(env.BEE_API_BASE).toBe(DEFAULT_BEE_API_BASE);
    expect(env.TRIAGE_MODEL).toBe(DEFAULT_TRIAGE_MODEL);
  });

  it("throws when BEE_TOKEN is missing", () => {
    const { BEE_TOKEN: _omit, ...rest } = base;
    expect(() => getEnv(rest)).toThrow(/BEE_TOKEN/);
  });

  it("throws when DATABASE_URL is not a postgres URL", () => {
    expect(() => getEnv({ ...base, DATABASE_URL: "mysql://u:p@host/db" })).toThrow(/DATABASE_URL/);
  });

  it("throws when the webhook secret is shorter than 24 characters", () => {
    expect(() => getEnv({ ...base, EARMARK_WEBHOOK_SECRET: "short" })).toThrow(/EARMARK_WEBHOOK_SECRET/);
  });
});

describe("owner first name", () => {
  it("getEnv tolerates an empty EARMARK_OWNER_FIRST_NAME", () => {
    expect(() => getEnv({ ...base, EARMARK_OWNER_FIRST_NAME: "" })).not.toThrow();
  });
  it("ownerFirstName maps unset/blank to undefined and trims", () => {
    expect(ownerFirstName({})).toBeUndefined();
    expect(ownerFirstName({ EARMARK_OWNER_FIRST_NAME: "" })).toBeUndefined();
    expect(ownerFirstName({ EARMARK_OWNER_FIRST_NAME: "  " })).toBeUndefined();
    expect(ownerFirstName({ EARMARK_OWNER_FIRST_NAME: " Tarik " })).toBe("Tarik");
  });
});

describe("ownerDisplayName", () => {
  it("prefers the display name, falls back to the first name, else none", () => {
    expect(ownerDisplayName({ EARMARK_OWNER_DISPLAY_NAME: " Tarik Moody ", EARMARK_OWNER_FIRST_NAME: "Tarik" })).toBe("Tarik Moody");
    expect(ownerDisplayName({ EARMARK_OWNER_DISPLAY_NAME: "", EARMARK_OWNER_FIRST_NAME: "Tarik" })).toBe("Tarik");
    expect(ownerDisplayName({})).toBeUndefined();
  });
});
