import { neon } from "@neondatabase/serverless";

// Runs against the Neon `test` branch only (TEST_DATABASE_URL), never production: it inserts and deletes rows.
// Run: node --env-file=.env.local scripts/check-schema.mjs
if (!process.env.TEST_DATABASE_URL) {
  console.log("TEST_DATABASE_URL not set; skipping");
  process.exit(0);
}
const sql = neon(process.env.TEST_DATABASE_URL);
const tables = await sql`select table_name from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`;
console.log("tables", tables.length, tables.map((t) => t.table_name).join(","));

const insert = (excerpt) => sql`insert into recommendations (type, raw_text, canonical_name, excerpt, said_at, source, confidence)
  values ('other', 'check-schema', 'check-schema', ${excerpt}, now(), 'ambient', 0.9) returning id`;
const words = (n) => Array(n).fill("w").join(" ");

try {
  await insert(words(26));
  console.log("26 words: NOT REJECTED");
} catch (e) {
  console.log("26 words rejected", /check/i.test(e.message));
}
try {
  const [row] = await insert(words(25)); // control: the limit itself is allowed
  console.log("25 words accepted", Boolean(row.id));
} finally {
  await sql`delete from recommendations where raw_text = 'check-schema'`;
  const [left] = await sql`select count(*)::int as n from recommendations where raw_text = 'check-schema'`;
  console.log("leftover test rows", left.n);
}
