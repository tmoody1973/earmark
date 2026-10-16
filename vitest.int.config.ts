import { defineConfig } from "vitest/config";

// Integration tests hit the Neon `test` branch only (TEST_DATABASE_URL), never production.
export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    setupFiles: ["tests/integration/setup.ts"],
    environment: "node",
  },
});
