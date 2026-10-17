// usage: pnpm forget <rec|idea|mention> <id> [--dry-run]
import { forget, type ForgetTarget } from "../agent/lib/privacy/forget";

const [type, rawId, flag] = process.argv.slice(2);
const id = Number(rawId);
if (!["rec", "idea", "mention"].includes(type ?? "") || !Number.isInteger(id) || id <= 0 || (flag && flag !== "--dry-run")) {
  console.error("usage: pnpm forget <rec|idea|mention> <id> [--dry-run]");
  process.exit(1);
}
for (const line of await forget({ type: type as ForgetTarget["type"], id }, { dryRun: flag === "--dry-run" })) {
  console.log(line);
}
