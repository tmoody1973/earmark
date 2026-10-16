import { readdir, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { Pool } from "@neondatabase/serverless";

const DIR = "db/migrations";

export function planMigrations(files: string[], applied: Set<string>): string[] {
  return files.filter((f) => f.endsWith(".sql")).sort().filter((f) => !applied.has(f));
}

async function main(): Promise<void> {
  // `--test` migrates the Neon `test` branch that the integration tests use.
  const target = process.argv.includes("--test") ? "TEST_DATABASE_URL" : "DATABASE_URL";
  const connectionString = process.env[target];
  if (!connectionString) throw new Error(`${target} is not set`);
  console.log(`target ${target}`);
  const pool = new Pool({ connectionString });
  const client = await pool.connect();
  try {
    // 001_init.sql creates schema_migrations itself, so only read it if it exists.
    const { rows: exists } = await client.query("select to_regclass('public.schema_migrations') as t");
    const applied = new Set<string>();
    if (exists[0]?.t) {
      const { rows } = await client.query("select name from schema_migrations");
      for (const r of rows) applied.add(r.name as string);
    }
    const todo = planMigrations(await readdir(DIR), applied);
    for (const file of todo) {
      const sql = await readFile(`${DIR}/${file}`, "utf8");
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations (name) values ($1)", [file]);
        await client.query("commit");
        console.log(`applied ${file}`);
      } catch (err) {
        await client.query("rollback");
        throw err;
      }
    }
    if (todo.length === 0) console.log("up to date");
  } finally {
    client.release();
    await pool.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
