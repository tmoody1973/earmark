// Search providers by name (fixture recorder; grows in M3-T4). Keyed providers appear only when their env is set.
import { appleAccess, appleMusicSearch } from "./apple-music";
import { musicBrainzProvider } from "./musicbrainz";
import type { ProviderDef } from "./types";

export function providersByName(env: Record<string, string | undefined> = process.env): Record<string, ProviderDef> {
  const apple = appleAccess(env);
  return { musicbrainz: musicBrainzProvider, ...(apple ? { apple: appleMusicSearch(apple) } : {}) };
}
