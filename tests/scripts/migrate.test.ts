import { describe, expect, it } from "vitest";
import { planMigrations } from "../../scripts/migrate";

describe("planMigrations", () => {
  it("returns unapplied .sql files in lexical order", () => {
    const files = ["010_spaces.sql", "002_ideas.sql", "001_init.sql", "README.md"];
    expect(planMigrations(files, new Set())).toEqual(["001_init.sql", "002_ideas.sql", "010_spaces.sql"]);
  });

  it("skips files already recorded in schema_migrations", () => {
    const files = ["001_init.sql", "002_ideas.sql"];
    expect(planMigrations(files, new Set(["001_init.sql"]))).toEqual(["002_ideas.sql"]);
  });

  it("returns nothing when everything is applied", () => {
    expect(planMigrations(["001_init.sql"], new Set(["001_init.sql"]))).toEqual([]);
  });
});
