import { z } from "zod";
import { getEnv } from "../env";

export class BeeApiError extends Error {
  readonly status: number;
  readonly path: string;
  constructor(status: number, path: string, body: string) {
    super(`Bee API ${status} on ${path}: ${body.slice(0, 200)}`);
    this.name = "BeeApiError";
    this.status = status;
    this.path = path;
  }
}

const Timestamp = z.union([z.number(), z.string()]);

export function toDate(v: number | string | null | undefined): Date | null {
  if (v === null || v === undefined) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

const UtteranceSchema = z.object({
  id: z.number().optional(), // the same id the live stream sends with each new-utterance
  text: z.string(),
  speaker: z.string().default("Unknown"),
  spoken_at: Timestamp.nullable().optional(),
});
const TranscriptionSchema = z.object({
  realtime: z.boolean().default(false),
  utterances: z.array(UtteranceSchema).default([]),
});
const ConversationSummarySchema = z.object({
  id: z.number(),
  start_time: Timestamp,
  end_time: Timestamp.nullable().optional(),
  summary: z.string().nullable().optional(),
  state: z.string(),
});
const ConversationSchema = ConversationSummarySchema.extend({
  short_summary: z.string().nullable().optional(),
  transcriptions: z.array(TranscriptionSchema).default([]),
  primary_location: z
    .object({ address: z.string().nullable().optional(), latitude: z.number(), longitude: z.number() })
    .nullable()
    .optional(),
});
const JournalSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  text: z.string().nullable(),
  state: z.string(),
  created_at: Timestamp,
});
const TodoSchema = z.object({
  id: z.number(),
  text: z.string(),
  completed: z.boolean(),
  alarm_at: Timestamp.nullable().optional(),
});
const Cursor = z.string().nullable().optional().transform((c) => c ?? null);

// GET /v1/changes (observed 2026-10-16): the cursor/window fields are TOP level (no `meta` wrapper) and the lists hold
// bare numeric ids. A non-empty journals list has not been seen yet, so objects with an `id` are accepted too.
const ChangeItemSchema = z.union([z.number(), z.string(), z.object({ id: z.union([z.number(), z.string()]) })]);
const changeList = z.array(ChangeItemSchema).default([]);
export const BeeChangesSchema = z.object({
  next_cursor: z.string(),
  since: z.number(),
  until: z.number(),
  updated: z.boolean(),
  timezone: z.string(),
  facts: changeList,
  todos: changeList,
  dailies: changeList,
  conversations: changeList,
  journals: changeList,
});
export type BeeChanges = z.infer<typeof BeeChangesSchema>;

export type ConversationSummary = z.infer<typeof ConversationSummarySchema>;
export type Conversation = z.infer<typeof ConversationSchema>;
export type Journal = z.infer<typeof JournalSchema>;
export type Todo = z.infer<typeof TodoSchema>;

type Page = { limit?: number; cursor?: string };

function query(params: Record<string, string | number | boolean | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) qs.set(k, String(v));
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export function createBeeClient(opts: { token?: string; baseUrl?: string; fetchImpl?: typeof fetch } = {}) {
  const token = opts.token ?? getEnv().BEE_TOKEN;
  const baseUrl = opts.baseUrl ?? getEnv().BEE_API_BASE;
  const fetchImpl = opts.fetchImpl ?? fetch;

  async function call<S extends z.ZodType>(path: string, schema: S, init: RequestInit = {}): Promise<z.infer<S>> {
    const res = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers },
      signal: init.signal ?? AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    if (!res.ok) throw new BeeApiError(res.status, path, text);
    return schema.parse(text ? JSON.parse(text) : {});
  }

  return {
    me: () => call("/v1/me", z.record(z.string(), z.unknown())),
    listConversations: (p: Page = {}) =>
      call(`/v1/conversations${query(p)}`, z.object({ conversations: z.array(ConversationSummarySchema), next_cursor: Cursor })),
    getConversation: (id: number) => call(`/v1/conversations/${id}`, z.object({ conversation: ConversationSchema })),
    listJournals: (p: Page = {}) =>
      call(`/v1/journals${query(p)}`, z.object({ journals: z.array(JournalSchema), next_cursor: Cursor })),
    getJournal: (id: string) => call(`/v1/journals/${encodeURIComponent(id)}`, JournalSchema),
    listTodos: (p: Page = {}) =>
      call(`/v1/todos${query(p)}`, z.object({ todos: z.array(TodoSchema), next_cursor: Cursor })),
    changes: (cursor?: string) => call(`/v1/changes${query({ cursor })}`, BeeChangesSchema),
  };
}

export type BeeClient = ReturnType<typeof createBeeClient>;
