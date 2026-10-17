import { db } from "../db";

/** Approving an episode run is what publishes the episode to the private feed. Idempotent. */
export async function publishEpisode(episodeId: number): Promise<void> {
  await db()`update episodes set published_at = now() where id = ${episodeId} and published_at is null`;
}

/**
 * Approve or dismiss a draft run. Only a draft can change state, so repeating a click is a no-op and a dismissed
 * run can never publish later. Dismissing leaves a linked episode unpublished.
 */
export async function decideRun(runId: number, status: "approved" | "dismissed"): Promise<void> {
  const rows = (await db()`
    update gardener_runs set status = ${status} where id = ${runId} and status = 'draft' returning episode_id`) as { episode_id: number | string | null }[];
  const episodeId = rows[0]?.episode_id;
  if (status === "approved" && episodeId) await publishEpisode(Number(episodeId));
}
