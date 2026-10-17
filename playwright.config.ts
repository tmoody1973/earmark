import { defineConfig, devices } from "@playwright/test";

// Local-only: the Clerk keys and owner id come from .env.local (never committed).
try {
  process.loadEnvFile(".env.local");
} catch {
  // CI or a fresh clone: the environment must already provide the Clerk variables.
}

// e2e never writes production (M4-T4): the dev server Playwright starts reads the Neon TEST branch, always.
// Real-data runs (E2E_REAL) are disabled: GARDEN_READ_ONLY guards only some writes, so they could write production.
// They come back only with a database role that cannot write (decision 042).
// EARMARK_E2E=1 arms the startup guard (instrumentation.ts → agent/lib/e2e-guard.ts), which refuses any other database.
if (process.env.E2E_REAL) {
  throw new Error(
    "E2E_REAL is disabled: real-data runs need a read-only database role (see decision 042). Run e2e on the test branch.",
  );
}
const TEST_DB = process.env.TEST_DATABASE_URL;
if (!TEST_DB) throw new Error("TEST_DATABASE_URL is not set: e2e runs on the Neon test branch.");
const serverEnv: Record<string, string> = {
  ...(Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)) as Record<string, string>),
  EARMARK_E2E: "1",
  DATABASE_URL: TEST_DB,
};

// E2E_PORT: pick a free port per checkout. Never reuse a running server: one started by hand may read production.
const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  workers: 1,
  reporter: "list",
  use: { baseURL: `http://localhost:${PORT}` },
  webServer: {
    command: `pnpm exec next dev --port ${PORT}`,
    url: `http://localhost:${PORT}/sign-in`,
    env: serverEnv,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
    // iPhone 13 emulation, run in chromium (the only browser we install).
    { name: "phone", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
  ],
});
