// M6-T8: no committed JSON fixture may carry more than 25 words of anyone's speech (the repo is public).
// Prints file, JSON path and word count only, never the text: an offender may be real speech.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const MAX_WORDS = 25;
const IGNORE = [
  /(^|\/)package\.json$/, /tsconfig[^/]*\.json$/, /^\.impeccable\//, /\.vercel\//, /^docs\//,
  /^tests\/fixtures\/enrich\//, // recorded public catalog responses (TMDB synopses, Wikipedia extracts), not speech
];

const files = execFileSync("git", ["ls-files", "*.json", "*.jsonl"], { encoding: "utf8" })
  .split("\n")
  .filter((f) => f && !IGNORE.some((re) => re.test(f)));

const offenders: string[] = [];
const walk = (value: unknown, where: string): void => {
  if (typeof value === "string") {
    const words = value.trim().split(/\s+/).filter(Boolean).length;
    if (words > MAX_WORDS) offenders.push(`${where}: ${words} words`);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => walk(v, `${where}[${i}]`));
  } else if (value && typeof value === "object") {
    Object.entries(value).forEach(([k, v]) => walk(v, `${where}.${k}`));
  }
};

for (const file of files) {
  const text = readFileSync(file, "utf8");
  const docs = file.endsWith(".jsonl") ? text.split("\n").filter(Boolean) : [text];
  docs.forEach((doc, i) => walk(JSON.parse(doc), file.endsWith(".jsonl") ? `${file}:${i + 1}` : file));
}
console.log(`${files.length} files scanned`);
if (offenders.length > 0) {
  console.error(offenders.join("\n"));
  process.exit(1);
}
