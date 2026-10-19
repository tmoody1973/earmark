import { afterEach, describe, expect, it, vi } from "vitest";
import { assertDemoSafe, DEMO_HEADER, DEMO_READ_ONLY, demoProblem, demoWriteRefusal, isDemo, skipInDemo } from "../../agent/lib/demo";
import { gardenReadOnly } from "../../agent/lib/e2e-guard";
import { gate, isOwner } from "../../agent/lib/owner";

// The judge demo (decision 053): read-only Earmark on invented sample data at its own URL.
const DEMO_DB = "postgres://demo_reader:pw@ep-quiet-demo-123456-pooler.us-east-2.aws.neon.tech/neondb";
const PROD_HOST = "ep-busy-prod-654321.us-east-2.aws.neon.tech";
const ON = { EARMARK_DEMO: "1", EARMARK_DEMO_DB_OK: "1", DATABASE_URL: DEMO_DB };

afterEach(() => vi.unstubAllEnvs());

describe("isDemo / demoProblem (the switch, and the startup refusal in instrumentation.ts)", () => {
  it("is off unless EARMARK_DEMO=1", () => {
    expect(isDemo({})).toBe(false);
    expect(isDemo({ ...ON, EARMARK_DEMO: "true" })).toBe(false);
    expect(demoProblem({})).toBeNull();
    expect(() => assertDemoSafe({})).not.toThrow();
  });

  it("is on with EARMARK_DEMO=1 and EARMARK_DEMO_DB_OK=1", () => {
    expect(isDemo(ON)).toBe(true);
    expect(demoProblem(ON)).toBeNull();
    expect(() => assertDemoSafe(ON)).not.toThrow();
  });

  it("refuses demo mode without EARMARK_DEMO_DB_OK=1, and stays off", () => {
    const env = { ...ON, EARMARK_DEMO_DB_OK: undefined };
    expect(demoProblem(env)).toMatch(/EARMARK_DEMO_DB_OK/);
    expect(isDemo(env)).toBe(false);
    expect(() => assertDemoSafe(env)).toThrow(/demo mode refused/);
  });

  it("refuses demo mode on the production database host, pooled or direct, and stays off", () => {
    for (const prod of [PROD_HOST, PROD_HOST.replace(".us-east", "-pooler.us-east")]) {
      const env = { ...ON, EARMARK_PROD_DB_HOST: PROD_HOST, DATABASE_URL: `postgres://u:p@${prod}/neondb?sslmode=require` };
      expect(demoProblem(env)).toMatch(/production/);
      expect(isDemo(env)).toBe(false);
      expect(() => assertDemoSafe(env)).toThrow(/production/);
    }
  });

  it("accepts EARMARK_PROD_DB_HOST as a host or a whole URL, and allows any other host", () => {
    expect(isDemo({ ...ON, EARMARK_PROD_DB_HOST: PROD_HOST })).toBe(true);
    expect(isDemo({ ...ON, EARMARK_PROD_DB_HOST: `postgres://x:y@${PROD_HOST}/neondb` })).toBe(true);
    const onProd = { ...ON, DATABASE_URL: `postgres://u:p@${PROD_HOST}/neondb`, EARMARK_PROD_DB_HOST: `postgres://x:y@${PROD_HOST}/neondb` };
    expect(isDemo(onProd)).toBe(false);
  });

  it("refuses when the prod host is set but DATABASE_URL is missing or unreadable", () => {
    expect(demoProblem({ ...ON, EARMARK_PROD_DB_HOST: PROD_HOST, DATABASE_URL: undefined })).toMatch(/DATABASE_URL/);
    expect(demoProblem({ ...ON, EARMARK_PROD_DB_HOST: PROD_HOST, DATABASE_URL: "not a url" })).toMatch(/DATABASE_URL/);
  });

  it("never puts the database URL in the error", () => {
    const env = { ...ON, EARMARK_PROD_DB_HOST: PROD_HOST, DATABASE_URL: `postgres://u:SECRETPW@${PROD_HOST}/neondb` };
    expect(() => assertDemoSafe(env)).toThrow(expect.objectContaining({ message: expect.not.stringContaining("SECRETPW") }));
  });
});

describe("demoWriteRefusal (proxy.ts: the one write guard)", () => {
  it("refuses every write in demo mode with the friendly message", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const res = demoWriteRefusal(method, ON)!;
      expect(res.status).toBe(403);
      expect(res.headers.get(DEMO_HEADER)).toBe("read-only");
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({ error: DEMO_READ_ONLY });
    }
    expect(DEMO_READ_ONLY).toBe("This is a read-only demo.");
  });

  it("lets reads through in demo mode", () => {
    for (const method of ["GET", "HEAD", "OPTIONS", "get"]) expect(demoWriteRefusal(method, ON)).toBeNull();
  });

  it("does nothing outside demo mode", () => {
    expect(demoWriteRefusal("POST", {})).toBeNull();
    expect(demoWriteRefusal("POST", { ...ON, EARMARK_DEMO_DB_OK: undefined })).toBeNull();
  });
});

describe("the owner gate opens only in demo mode", () => {
  it("everyone views the owner's pages in demo mode, signed in or not", () => {
    vi.stubEnv("EARMARK_DEMO", "1");
    vi.stubEnv("EARMARK_DEMO_DB_OK", "1");
    expect(isOwner(null, "user_abc")).toBe(true);
    expect(isOwner("user_xyz", undefined)).toBe(true);
    expect(gate("/", null, "user_abc")).toBe("allow");
    expect(gate("/tips/4", "user_xyz", "user_abc")).toBe("allow");
  });

  it("stays shut when the demo switch is on but refused", () => {
    vi.stubEnv("EARMARK_DEMO", "1");
    vi.stubEnv("EARMARK_DEMO_DB_OK", "");
    expect(isOwner(null, "user_abc")).toBe(false);
    expect(gate("/", null, "user_abc")).toBe("sign-in");
    expect(gate("/", "user_xyz", "user_abc")).toBe("forbid");
  });

  it("stays shut outside demo mode", () => {
    vi.stubEnv("EARMARK_DEMO", "");
    expect(isOwner(null, "user_abc")).toBe(false);
    expect(gate("/", null, "user_abc")).toBe("sign-in");
  });
});

describe("render-time garden writes are no-ops in demo mode", () => {
  it("gardenReadOnly is on in demo mode", () => {
    expect(gardenReadOnly(ON)).toBe(true);
    expect(gardenReadOnly({ ...ON, EARMARK_DEMO_DB_OK: undefined })).toBe(false);
  });
});

describe("skipInDemo (background work)", () => {
  it("says skip in demo mode only, naming the job", () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    expect(skipInDemo("rec-lane", ON)).toBe(true);
    expect(log).toHaveBeenCalledWith("[rec-lane] skipped: read-only demo");
    expect(skipInDemo("rec-lane", {})).toBe(false);
    log.mockRestore();
  });
});
