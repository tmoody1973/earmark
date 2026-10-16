import { auth } from "@clerk/nextjs/server";
import { isOwner } from "@/agent/lib/owner";
import { MAP_ZOOM, osmTileUrl } from "@/agent/lib/garden/cards";

// One OpenStreetMap tile per place card, fetched server-side so every request carries an identifying
// User-Agent and is cached (OSM tile usage policy). Only the zoom the cards use is served: this is not a tile CDN.
const WEEK = 60 * 60 * 24 * 7;
const USER_AGENT = "Earmark/0.1 (single-user personal garden; +https://github.com/tmoody1973/earmark)";

const int = (s: string) => (/^\d{1,6}$/.test(s) ? Number(s) : NaN);

export async function GET(_req: Request, { params }: { params: Promise<{ z: string; x: string; y: string }> }) {
  // proxy.ts already gates /api; checked again here so the tile fetch can never become an open proxy.
  const { userId } = await auth();
  if (!isOwner(userId)) return new Response(null, { status: 404 });

  const p = await params;
  const z = int(p.z), x = int(p.x), y = int(p.y);
  const n = 2 ** MAP_ZOOM;
  if (z !== MAP_ZOOM || !(x < n) || !(y < n)) return new Response(null, { status: 400 });

  try {
    const res = await fetch(osmTileUrl({ z, x, y }), {
      headers: { "User-Agent": USER_AGENT },
      next: { revalidate: WEEK },
    });
    if (!res.ok) return new Response(null, { status: 502 });
    return new Response(res.body, {
      headers: { "content-type": "image/png", "cache-control": `private, max-age=${WEEK}` },
    });
  } catch (err) {
    console.error("osm tile fetch failed", { z, x, y, err: String(err) });
    return new Response(null, { status: 502 });
  }
}
