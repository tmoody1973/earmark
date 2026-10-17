// The owner's own photo thumbnails (M5-T3) live in Vercel Blob under thumbs/. They stay off every public page and link
// preview (/s, /r, og:image): EXIF stripping of the stored JPEG is not verified, so location or device data could ride along.
export const THUMB_PREFIX = "thumbs/";

export function publicImageUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.hostname.endsWith(".blob.vercel-storage.com") && u.pathname.startsWith(`/${THUMB_PREFIX}`) ? null : url;
  } catch {
    return null; // not a URL at all: nothing safe to show
  }
}
