import { z } from "zod";

const Id = z.union([z.number(), z.string()]).transform(String);

const env = <E extends string, D extends z.ZodType>(event: E, data: D) =>
  z.object({ event: z.literal(event), ts: z.string().optional(), data });

const Todo = z.object({
  todo: z.object({ id: z.number(), text: z.string(), completed: z.boolean().optional(), alarmAt: z.number().nullable().optional() }),
});
const Journal = z.object({
  journal: z.object({ id: Id, state: z.string().optional(), text: z.string().nullable().optional() }),
});

export const BeeEventSchema = z.discriminatedUnion("event", [
  env("connected", z.unknown()),
  // Live shape (observed 2026-10-16): the utterance carries its REST utterance id and spoken_at, and no speaker.
  // The id is how an unmapped conversation_uuid is matched to its numeric conversation (see pipeline/live.ts).
  env("new-utterance", z.object({
    utterance: z.object({
      id: z.number().optional(), text: z.string(), speaker: z.string().default("Unknown"), spoken_at: z.string().optional(),
    }),
    conversation_uuid: z.string(),
  })),
  // Documented: {conversation:{id,uuid,...}}. The live payload differed from the docs (400s in prod, 2026-10-16), so any object
  // is accepted and conversationRef() digs the id/uuid out of whichever shape arrives. See docs/research/bee-api.md.
  env("new-conversation", z.record(z.string(), z.unknown())),
  env("update-conversation", z.object({
    conversation: z.object({ id: z.number(), state: z.string().optional(), title: z.string().nullable().optional(), short_summary: z.string().nullable().optional() }),
  })),
  env("update-conversation-summary", z.object({ conversation_id: z.number(), short_summary: z.string().nullable().optional() })),
  env("delete-conversation", z.object({ conversation: z.object({ id: z.number() }) })),
  env("update-location", z.object({
    conversation_id: z.number().nullable().optional(),
    location: z.object({ latitude: z.number(), longitude: z.number(), name: z.string().nullable().optional() }),
  })),
  env("todo-created", Todo),
  env("todo-updated", Todo),
  env("todo-deleted", z.object({ todo: z.object({ id: z.number(), text: z.string().optional() }) })),
  env("journal-created", Journal),
  env("journal-updated", Journal),
  env("journal-deleted", z.object({ journalId: Id, reason: z.string().optional() })),
  env("journal-text", z.object({ journalId: Id, text: z.string() })),
]);

// Stream sends numeric journal ids, REST sends strings; Id above normalizes both to string.
const COMPLETE_STATES = new Set(["processed", "ready", "completed"]);
export function isJournalComplete(state: string | null | undefined): boolean {
  return typeof state === "string" && COMPLETE_STATES.has(state.toLowerCase());
}

const asId = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) ? n : null;
};
const asUuid = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const obj = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/**
 * The uuid and numeric id of a new conversation. Both must come from the SAME level (never mixed): `conversation.{uuid,id}`
 * (documented), then `{conversation_uuid,conversation_id}`, then `{uuid,id}`. Null when no level has both.
 */
export function conversationRef(data: Record<string, unknown>): { uuid: string; id: number } | null {
  const c = obj(data.conversation);
  const levels: Array<[unknown, unknown]> = [[c.uuid, c.id], [data.conversation_uuid, data.conversation_id], [data.uuid, data.id]];
  for (const [u, i] of levels) {
    const uuid = asUuid(u);
    const id = asId(i);
    if (uuid && id !== null) return { uuid, id };
  }
  return null;
}

export type BeeEvent = z.infer<typeof BeeEventSchema>;

export function parseBeeEnvelope(body: unknown): BeeEvent {
  return BeeEventSchema.parse(body);
}
