import { BeeApiError, createBeeClient } from "../bee/client";
import { db } from "../db";

// Bee todo/fact changes arrive here from /v1/changes. M3 (todo two-way sync) replaces the todo body; keep the
// signatures. Handlers must be idempotent: a failed batch is replayed.
export async function handleTodoChange(id: number): Promise<void> {
  void id;
}

// FR-19 mirror: the owner confirms a proposed fact in Bee → 'confirmed'; deletes it (Bee answers 404) → 'rejected'.
export async function handleFactChange(id: number): Promise<void> {
  const [proposal] = (await db()`
    select id, kind, evidence_ids, status from fact_proposals where bee_fact_id = ${id}`) as {
    id: number; kind: "taste" | "idea"; evidence_ids: number[]; status: string;
  }[];
  if (!proposal) return; // not an Earmark fact; Bee's own facts are not mirrored
  let confirmed: boolean;
  try {
    confirmed = (await createBeeClient().getFact(id)).confirmed;
  } catch (err) {
    if (err instanceof BeeApiError && err.status === 404) {
      await db()`update fact_proposals set status = 'rejected' where id = ${proposal.id}`;
      await db()`delete from bee_sync where bee_object = 'fact' and bee_id = ${id}`;
      return;
    }
    throw err;
  }
  if (!confirmed || proposal.status === "confirmed") return;
  await db()`update fact_proposals set status = 'confirmed' where id = ${proposal.id}`;
  if (proposal.kind === "idea" && proposal.evidence_ids[0] !== undefined) {
    await db()`update idea_clusters set bee_fact_id = ${id}, updated_at = now() where id = ${proposal.evidence_ids[0]}`;
  }
}
