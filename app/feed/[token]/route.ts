import { safeEqual } from "@/agent/lib/capture/auth";
import { db } from "@/agent/lib/db";
import { getEnv } from "@/agent/lib/env";

// Never prerender: the feed depends on the token and on the database at request time.
export const dynamic = "force-dynamic";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const token = getEnv().EARMARK_FEED_TOKEN;
  // 404, not 401: a wrong token must not confirm that this route exists.
  if (!token || !safeEqual((await params).token, token)) return new Response("not found", { status: 404 });
  const eps = (await db()`
    select week_of::text as week_of, script_md, audio_url, audio_bytes, published_at from episodes
    where published_at is not null and audio_url is not null order by week_of desc limit 20`) as {
    week_of: string; script_md: string; audio_url: string; audio_bytes: number | null; published_at: string | Date;
  }[];
  const items = eps.map((e) => {
    const [title, , ...rest] = e.script_md.split("\n");
    return `<item><title>${esc(title)}</title><description>${esc(rest.join(" ").slice(0, 400))}</description>`
      + `<enclosure url="${esc(e.audio_url)}" length="${e.audio_bytes ?? 0}" type="audio/mpeg"/>`
      + `<guid isPermaLink="false">earmark-${esc(e.week_of)}</guid><pubDate>${new Date(e.published_at).toUTCString()}</pubDate></item>`;
  }).join("");
  const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel>`
    + `<title>Earmark</title><link>${esc(new URL(req.url).origin)}</link><description>Your week of ideas and recommendations.</description><language>en-us</language>`
    + `<itunes:block>Yes</itunes:block>${items}</channel></rss>`;
  return new Response(xml, { headers: { "content-type": "application/rss+xml; charset=utf-8", "x-robots-tag": "noindex, nofollow", "cache-control": "private, max-age=300" } });
}
