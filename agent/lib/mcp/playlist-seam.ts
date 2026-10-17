export type PlaylistResult = "added" | "no_auth" | "not_music" | "already" | "no_match" | "not_connected";

// Stub: forwards to addRecToPlaylist in agent/lib/music/library.ts when M3-T6 lands.
export async function addRecToPlaylist(_recId: number): Promise<PlaylistResult> {
  return "not_connected";
}
