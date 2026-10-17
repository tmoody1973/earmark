import type { RecType } from "../types";

export type CardVariant = "cover" | "artist" | "spine" | "map" | "tile" | "poster" | "screen" | "note";

const VARIANTS = {
  album: "cover",
  song: "cover",
  artist: "artist",
  book: "spine",
  place: "map",
  podcast: "tile",
  film_tv: "poster",
  video: "screen",
  other: "note",
} as const satisfies Record<RecType, CardVariant>;

export function cardVariant(type: RecType): CardVariant {
  return VARIANTS[type];
}

/** Only web links survive, and always as https (http is upgraded), so a card never loads mixed content or a script URL. */
function toHttps(v: unknown): string | null {
  if (typeof v !== "string" || !/^https?:\/\//i.test(v)) return null;
  return v.replace(/^https?:\/\//i, "https://");
}

/** Apple Music artwork URLs are templates containing {w}x{h}; others pass through. Non-web values are dropped. */
export function cardArtworkUrl(url: string | null, px: number): string | null {
  return toHttps(url)?.replace("{w}", String(px)).replace("{h}", String(px)) ?? null;
}

/** An <img> that finished loading with no pixels failed — possibly before React attached its onError handler. */
export function imageLoadFailed(img: { complete: boolean; naturalWidth: number }): boolean {
  return img.complete && img.naturalWidth === 0;
}

/** Stable hue per title so a book spine (or a typographic ground) keeps its colour across renders. */
export function spineHue(title: string): number {
  let h = 2166136261;
  for (let i = 0; i < title.length; i++) {
    h ^= title.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 360;
}

export interface Tile { x: number; y: number; z: number; pinX: number; pinY: number }

/** Standard slippy-map tile math; pinX/pinY are pixel offsets inside the 256px tile. */
export function lonLatToTile(lat: number, lng: number, zoom: number): Tile {
  const n = 2 ** zoom;
  const xf = ((lng + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const yf = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  const x = Math.floor(xf);
  const y = Math.floor(yf);
  return { x, y, z: zoom, pinX: (xf - x) * 256, pinY: (yf - y) * 256 };
}

export function osmTileUrl(t: Pick<Tile, "x" | "y" | "z">): string {
  return `https://tile.openstreetmap.org/${t.z}/${t.x}/${t.y}.png`;
}

export const MAP_ZOOM = 16;

export type CardArtwork = { kind: "image"; src: string } | { kind: "map"; tile: Tile } | { kind: "none" };

/**
 * What fills a card's artwork box. Artists never show a photo (no photos of people); a place without a photo
 * gets one OpenStreetMap tile when it has coordinates; everything else falls back to its typographic state.
 */
export function cardArtwork(c: { variant: CardVariant; imageUrl: string | null; lat: number | null; lng: number | null }): CardArtwork {
  if (c.variant === "artist") return { kind: "none" };
  if (c.imageUrl) return { kind: "image", src: c.imageUrl };
  if (c.variant === "map" && c.lat !== null && c.lng !== null) return { kind: "map", tile: lonLatToTile(c.lat, c.lng, MAP_ZOOM) };
  return { kind: "none" };
}

export const WHY_MAX_WORDS = 30;

/** The card's "why": the real context summary, cut to 30 words. Missing stays missing; nothing stands in for it. */
export function clampWhy(summary: string | null, max = WHY_MAX_WORDS): string | null {
  const words = summary?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (words.length === 0) return null;
  if (words.length <= max) return words.join(" ");
  return `${words.slice(0, max).join(" ").replace(/[\s.,;:!?…—–-]+$/u, "")}…`;
}

export function cardLink(links: unknown): string | null {
  if (!links || typeof links !== "object") return null;
  const record = links as Record<string, unknown>;
  return toHttps(record.apple_music) ?? toHttps(record.url) ?? Object.values(record).map(toHttps).find(Boolean) ?? null;
}
