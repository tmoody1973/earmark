import { describe, expect, it } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { resort } from "../../scripts/resort";

// A client whose first read fails and whose rollback fails too (a dropped connection does both).
const failing = (): PoolClient => ({
  query: async (text: string) => {
    if (text.startsWith("begin")) return { rows: [] };
    if (text === "rollback") throw Object.assign(new Error("rollback failed"), { name: "RollbackError" });
    throw Object.assign(new Error("read failed"), { name: "ReadError" });
  },
}) as unknown as PoolClient;

describe("resort transaction", () => {
  it("keeps the original error when the rollback also fails", async () => {
    await expect(resort(failing(), { apply: true })).rejects.toMatchObject({ name: "ReadError" });
  });
});
