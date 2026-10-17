// Which provider looks up which tip type. Keyless providers always run; keyed ones only once their env is set, and
// until then their types wait (the sweep doesn't select them, so they never burn attempts). Decision 013.
import type { RecType } from "../types";
import { appleAccess, appleMusicSearch } from "./apple-music";
import { musicBrainzProvider } from "./musicbrainz";
import { openLibraryProvider } from "./open-library";
import { placesProvider } from "./places";
import { itunesPodcastProvider, podcastIndexProvider } from "./podcasts";
import { tmdbProvider } from "./tmdb";
import type { ProviderDef } from "./types";
import { wikipediaProvider } from "./wikipedia";
import { youtubeOEmbedProvider } from "./youtube";

type Env = Record<string, string | undefined>;
export interface NamedProvider { name: string; def: ProviderDef }

// Same order as the recommendations.type check constraint.
export const REC_TYPES: readonly RecType[] = ["album", "song", "artist", "book", "place", "podcast", "film_tv", "video", "other"];

const set = (v: string | undefined) => (v?.trim() ? v.trim() : null);

/** null = this type's provider needs a key that isn't set yet. */
export function providerFor(type: RecType, env: Env = process.env): NamedProvider | null {
  switch (type) {
    case "album": case "song": case "artist":
      return { name: "musicbrainz", def: musicBrainzProvider }; // enrich.ts routes these through enrichMusic
    case "book":
      return { name: "openlibrary", def: openLibraryProvider };
    case "other":
      return { name: "wikipedia", def: wikipediaProvider };
    case "podcast": {
      const key = set(env.PODCAST_INDEX_KEY);
      const secret = set(env.PODCAST_INDEX_SECRET);
      return key && secret ? { name: "podcastindex", def: podcastIndexProvider(key, secret) } : { name: "itunes", def: itunesPodcastProvider };
    }
    case "film_tv": {
      const token = set(env.TMDB_API_KEY);
      return token ? { name: "tmdb", def: tmdbProvider(token) } : null;
    }
    case "video":
      return { name: "youtube", def: youtubeOEmbedProvider }; // keyless; enrich.ts routes these through enrichVideo
    case "place": {
      const key = set(env.GOOGLE_PLACES_API_KEY);
      return key ? { name: "places", def: placesProvider(key) } : null;
    }
  }
}

export const enabledTypes = (env: Env = process.env): RecType[] => REC_TYPES.filter((t) => providerFor(t, env));

// Every configured search provider by name (the fixture recorder). Apple appears only when APPLE_* is set.
export function providersByName(env: Env = process.env): Record<string, ProviderDef> {
  const byName: Record<string, ProviderDef> = { itunes: itunesPodcastProvider };
  for (const t of REC_TYPES) {
    const p = providerFor(t, env);
    if (p) byName[p.name] = p.def;
  }
  const apple = appleAccess(env);
  return apple ? { ...byName, apple: appleMusicSearch(apple) } : byName;
}
