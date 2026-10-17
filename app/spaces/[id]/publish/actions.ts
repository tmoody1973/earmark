"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { gardenReadOnly } from "@/agent/lib/e2e-guard";
import * as publish from "@/agent/lib/spaces/publish";
import { requireOwner } from "@/app/gardeners/owner";

// Owner-only writes for the publish page (FR-42). requireOwner() first in every action; ids are validated, never trusted.
const Id = z.coerce.number().int().positive().safe();
const id = (raw: unknown) => {
  const parsed = Id.safeParse(raw);
  if (!parsed.success) throw new Error("invalid id");
  return parsed.data;
};
const done = (spaceId: number) => revalidatePath(`/spaces/${spaceId}/publish`);

/** Publishes (the same link on a re-publish). A read-only e2e run writes nothing. */
export async function publishAction(spaceId: number): Promise<{ published: boolean }> {
  await requireOwner();
  const sid = id(spaceId);
  if (gardenReadOnly()) return { published: false };
  const token = await publish.publishSpace(sid);
  done(sid);
  return { published: token !== null };
}

/** Unpublishes: the old link stops working at once. */
export async function unpublishAction(spaceId: number): Promise<{ changed: boolean }> {
  await requireOwner();
  const sid = id(spaceId);
  if (gardenReadOnly()) return { changed: false };
  const changed = await publish.unpublishSpace(sid);
  done(sid);
  return { changed };
}

export async function indexableAction(spaceId: number, on: boolean): Promise<{ changed: boolean }> {
  await requireOwner();
  const sid = id(spaceId);
  if (gardenReadOnly()) return { changed: false };
  const changed = await publish.setIndexable(sid, z.boolean().parse(on));
  done(sid);
  return { changed };
}

/** "They said yes to being named": the owner records a consent the recommender gave him. */
export async function consentAction(spaceId: number, recommenderId: number, on: boolean): Promise<{ changed: boolean }> {
  await requireOwner();
  const sid = id(spaceId);
  const rid = id(recommenderId);
  if (gardenReadOnly()) return { changed: false };
  const changed = await publish.setNameConsent(sid, rid, z.boolean().parse(on));
  done(sid);
  return { changed };
}
