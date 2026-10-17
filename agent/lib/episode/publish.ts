import { del, put } from "@vercel/blob";
import { db } from "../db";
import { weekOfSunday } from "../time";
import { gatherEpisodeData } from "./data";
import { writeEpisodeScript } from "./script";
import { chunkForPolly, synthesize } from "./voice";

export { weekOfSunday };

export interface EpisodeDeps {
  gather: typeof gatherEpisodeData;
  write: typeof writeEpisodeScript;
  voice: (script: string) => Promise<Uint8Array>;
  upload: (weekOf: string, audio: Uint8Array) => Promise<string>;
  remove: (url: string) => Promise<void>;
}

const defaults: EpisodeDeps = {
  gather: gatherEpisodeData,
  write: (data, weekOf) => writeEpisodeScript(data, weekOf),
  voice: (script) => synthesize(chunkForPolly(script)),
  // Public-but-unlisted: the random suffix makes the URL unguessable. See docs/decisions/035-episode-audio-privacy.md.
  upload: async (weekOf, audio) =>
    (await put(`episodes/earmark-${weekOf}.mp3`, Buffer.from(audio), { access: "public", addRandomSuffix: true, contentType: "audio/mpeg" })).url,
  remove: (url) => del(url),
};

const errName = (e: unknown) => (e instanceof Error ? e.name : "unknown");

// One episode per Chicago week. published_at stays null until Tarik approves it (M5-T12).
// A second call for the same week returns the stored episode and spends nothing.
export async function runEpisode(now: Date, overrides: Partial<EpisodeDeps> = {}): Promise<{ episodeId: number; title: string }> {
  const deps = { ...defaults, ...overrides };
  const weekOf = weekOfSunday(now);
  const [existing] = (await db()`select id, split_part(script_md, E'\n', 1) as title from episodes where week_of = ${weekOf}`) as { id: number | string; title: string }[];
  if (existing) return { episodeId: Number(existing.id), title: existing.title };
  let audioUrl: string | undefined;
  try {
    const { title: rawTitle, script } = await deps.write(await deps.gather(now), weekOf);
    const title = rawTitle.replace(/\s+/g, " ").trim();
    const audio = await deps.voice(script);
    audioUrl = await deps.upload(weekOf, audio);
    const [row] = (await db()`
      insert into episodes (week_of, script_md, audio_url, audio_bytes)
      values (${weekOf}, ${`${title}\n\n${script}`}, ${audioUrl}, ${audio.byteLength})
      returning id`) as { id: number | string }[];
    return { episodeId: Number(row.id), title };
  } catch (e) {
    // Log the week and the error class only: never script text, names or model output.
    console.error(`[episode] failed week=${weekOf} err=${errName(e)}`);
    if (audioUrl) await deps.remove(audioUrl).catch((d) => console.error(`[episode] audio cleanup failed week=${weekOf} err=${errName(d)}`));
    throw e;
  }
}
