// Read-only: runs enrichment for existing tips and prints ids, type, provider, outcome and whether art was found.
// Writes nothing (SELECT only). Never prints names, excerpts, links or payloads.
// usage: tsx --env-file=.env.local scripts/enrich-preview.ts [recId...]   (no ids: up to 8 visible tips, mixed types)
// Calls the providers (MusicBrainz serially, 1 req/s) and Jev via the Gateway, like one sweep would.
import { db } from "../agent/lib/db";
import { enrichRec, type RecToEnrich } from "../agent/lib/enrich/enrich";
import { providerFor } from "../agent/lib/enrich/registry";
import { ProviderHttpError } from "../agent/lib/enrich/types";
import { HIDDEN_TIP_STATUSES } from "../agent/lib/garden/queries";

const ids = process.argv.slice(2).map(Number).filter(Number.isSafeInteger);
const rows = (ids.length
  ? await db()`select id, type, canonical_name, creator, excerpt, lat, lng from recommendations where id = any(${ids}) order by id`
  : await db()`select id, type, canonical_name, creator, excerpt, lat, lng from recommendations
      where status <> all(${HIDDEN_TIP_STATUSES}::text[])
      order by row_number() over (partition by type order by id desc), id desc limit 8`) as RecToEnrich[];

for (const r of rows) {
  const id = Number(r.id); // bigserial arrives as a string
  const provider = providerFor(r.type)?.name;
  const head = `rec=${id} type=${r.type} provider=${provider ?? "none (key not set)"}`;
  if (!provider) {
    console.log(`${head} waiting`);
    continue;
  }
  try {
    const m = await enrichRec({ ...r, id });
    console.log(m ? `${head} matched p=${m.matchConfidence.toFixed(2)} art=${m.imageUrl ? "yes" : "no"}` : `${head} none`);
  } catch (err) {
    const status = err instanceof ProviderHttpError ? ` status=${err.status}` : "";
    console.log(`${head} error=${err instanceof Error ? err.name : "unknown"}${status}`);
  }
}
