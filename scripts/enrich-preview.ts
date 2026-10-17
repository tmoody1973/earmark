// Read-only: runs music enrichment for existing recs and prints ids + match ids/urls. Writes nothing.
// usage: tsx --env-file=.env.local scripts/enrich-preview.ts <recId> [recId...]
// Calls MusicBrainz, the Cover Art Archive and Jev (via the Gateway). Never prints names, excerpts or payloads.
import { db } from "../agent/lib/db";
import { enrichMusic } from "../agent/lib/enrich/music";
import { ProviderHttpError } from "../agent/lib/enrich/types";
import type { RecType } from "../agent/lib/types";

const ids = process.argv.slice(2).map(Number).filter(Number.isSafeInteger);
if (ids.length === 0) {
  console.error("usage: enrich-preview.ts <recId> [recId...]");
  process.exit(1);
}
const rows = (await db()`select id, type, canonical_name, creator, excerpt from recommendations
  where id = any(${ids}) and type in ('album','song','artist') order by id`) as
  { id: number; type: RecType; canonical_name: string; creator: string | null; excerpt: string }[];

for (const r of rows) {
  try {
    const m = await enrichMusic({
      recId: r.id, query: { type: r.type, name: r.canonical_name, creator: r.creator, lat: null, lng: null },
      described: r.creator ? `${r.canonical_name} by ${r.creator}` : r.canonical_name, excerpt: r.excerpt,
    });
    console.log(m
      ? `rec=${r.id} type=${r.type} matched p=${m.matchConfidence.toFixed(2)} mbid=${m.mbid} link=${m.links.musicbrainz} art=${m.imageUrl ?? "-"} apple=${m.appleMusicId ?? "-"}`
      : `rec=${r.id} type=${r.type} none`);
  } catch (err) {
    const status = err instanceof ProviderHttpError ? ` status=${err.status}` : "";
    console.log(`rec=${r.id} type=${r.type} error=${err instanceof Error ? err.name : "unknown"}${status}`);
  }
}
const missing = ids.filter((id) => !rows.some((r) => Number(r.id) === id)); // bigserial arrives as a string
if (missing.length) console.log(`not music or not found: ${missing.join(",")}`);
