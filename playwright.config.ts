import { defineConfig, devices } from "@playwright/test";

// Local-only: the Clerk keys and owner id come from .env.local (never committed).
try {
  process.loadEnvFile(".env.local");
} catch {
  // CI or a fresh clone: the environment must already provide the Clerk variables.
}

// E2E_PORT: a second checkout (another worktree's dev server may already hold 3100, and reuseExistingServer would
// silently test that one instead).
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
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
    // iPhone 13 emulation, run in chromium (the only browser we install).
    { name: "phone", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
  ],
});
