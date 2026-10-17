// Records ONE real provider response as a test fixture (no retries; MusicBrainz spacing applies).
// usage: record-enrichment-fixture.ts <provider> <type> "<name>" ["<creator>"] <outfile>
//        record-enrichment-fixture.ts coverart <release-group-mbid> <outfile>
import { writeFileSync } from "node:fs";
import { providersByName } from "../agent/lib/enrich/registry";
import { USER_AGENT, type EnrichQuery } from "../agent/lib/enrich/types";

const args = process.argv.slice(2);
const providers = providersByName();

async function request(): Promise<{ url: string; init: RequestInit; out: string | undefined }> {
  if (args[0] === "coverart") {
    return { url: `https://coverartarchive.org/release-group/${args[1]}`, init: { headers: { "User-Agent": USER_AGENT } }, out: args[2] };
  }
  const [provider, type, name, maybeCreator, maybeOut] = args;
  const def = providers[provider ?? ""];
  if (!def || !type || !name) return { url: "", init: {}, out: undefined };
  const q = { type, name, creator: maybeOut ? maybeCreator : null, lat: null, lng: null } as EnrichQuery;
  return { ...(await def.build(q)), out: maybeOut ?? maybeCreator };
}

const { url, init, out } = await request();
if (!url || !out) {
  console.error(`providers: ${[...Object.keys(providers), "coverart"].join(", ")} (apple appears once APPLE_* is set)`);
  process.exit(1);
}
const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
writeFileSync(out, `${JSON.stringify(await res.json(), null, 2)}\n`);
console.log(`${res.status} → ${out}`);
