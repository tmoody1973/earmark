import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": import.meta.dirname } }, // tsconfig "@/*" → repo root (app/ imports use it)
  test: {
    include: ["tests/**/*.test.ts"],
    // Real-database tests run only through `pnpm test:int` (vitest.int.config.ts), never by default,
    // so a DATABASE_URL in the shell can never point them at production.
    exclude: [...configDefaults.exclude, "tests/integration/**"],
    environment: "node",
  },
});
