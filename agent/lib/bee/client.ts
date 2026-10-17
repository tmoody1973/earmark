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
// POST /v1/todos reply (M3-T7): wrapped ({todo}) or bare is unverified live, so both are accepted. Only the id is read:
// Bee has already made the todo by the time we parse, so an unexpected extra/missing field must not throw.
const CreatedTodoSchema = z.union([
  z.object({ todo: z.object({ id: z.number() }).passthrough() }).transform((b) => b.todo),
  z.object({ id: z.number() }).passthrough(),
]);
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

// Search shapes verified live (docs/research/bee-api.md §7). Neural ids are numbers, keyword ids strings.
export const NeuralSearchSchema = z.object({
  results: z.array(z.object({
    id: z.number(),
    started_at: Timestamp.nullish(),
    stopped_at: Timestamp.nullish(),
    link: z.string().nullish(),
    locations: z.array(z.string()).default([]),
    short_summary: z.string().nullish(),
    detailed_summary: z.string().nullish(),
  })),
  total: z.number().optional(),
  timezone: z.string().optional(),
});
export const KeywordSearchSchema = z.object({
  results: z.array(z.object({
    id: z.string(),
    type: z.string(),
    score: z.number().optional(),
    summary: z.string().nullish(),
    snippet: z.string().nullish(),
    title_snippet: z.string().nullish(),
    created_at: Timestamp.nullish(),
  })),
  next_cursor: z.string().nullish(),
  search_mode: z.string().optional(),
  timezone: z.string().optional(),
});
const FactSchema = z.object({ id: z.number(), text: z.string(), tags: z.array(z.string()).default([]), created_at: Timestamp, confirmed: z.boolean() });
// GET/POST of one fact: the object may be top level or wrapped in `fact` (unverified live), so both are accepted.
const FactWrittenSchema = FactSchema.pick({ id: true, text: true, confirmed: true });
// createFact needs only the id: Bee has already made the fact by the time we parse, so an unexpected extra/missing field must not throw.
const CreatedFactSchema = z.union([z.object({ fact: z.object({ id: z.number() }).passthrough() }).transform((b) => b.fact), z.object({ id: z.number() }).passthrough()]);
const SingleFactSchema = z.union([z.object({ fact: FactWrittenSchema }).transform((b) => b.fact), FactWrittenSchema]);
export type NeuralSearchResult = z.infer<typeof NeuralSearchSchema>;
export type KeywordSearchResult = z.infer<typeof KeywordSearchSchema>;
export type BeeFact = z.infer<typeof FactSchema>;
export type KeywordSearchOptions = {
  filter?: "conversations" | "daily" | "facts" | "all";
  sortBy?: "relevance" | "mostRecent";
  since?: number;
  until?: number;
  limit?: number;
};

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
    // Todo writes (M3-T7): only sync/bee-todos.ts calls these, behind BEE_TODO_WRITES. A 404 surfaces as
    // BeeApiError.status. The PUT reply is unverified live and nothing reads it. alarm_at goes in as ISO 8601 (it comes
    // back as epoch ms; docs/research/bee-api.md); null or absent = no alarm.
    createTodo: (input: { text: string; alarmAt?: string | null }) =>
      call("/v1/todos", CreatedTodoSchema, {
        method: "POST",
        body: JSON.stringify(input.alarmAt ? { text: input.text, alarm_at: input.alarmAt } : { text: input.text }),
      }),
    updateTodo: async (id: number, patch: { text?: string; completed?: boolean }): Promise<void> => {
      await call(`/v1/todos/${id}`, z.unknown(), { method: "PUT", body: JSON.stringify(patch) });
    },
    changes: (cursor?: string) => call(`/v1/changes${query({ cursor })}`, BeeChangesSchema),
    // `q`, not `query`: that name is the query-string helper above. signal: a caller's own timeout (default 15 s).
    neuralSearch: (q: string, opts: { since?: number; until?: number; limit?: number } = {}, signal?: AbortSignal) =>
      call("/v1/search/conversations/neural", NeuralSearchSchema, { method: "POST", body: JSON.stringify({ query: q, ...opts }), signal }),
    keywordSearch: (q: string, opts: KeywordSearchOptions = {}, signal?: AbortSignal) =>
      call("/v1/search/conversations", KeywordSearchSchema, { method: "POST", body: JSON.stringify({ query: q, ...opts }), signal }),
    listFacts: ({ confirmed, limit = 50, cursor }: { confirmed: boolean; limit?: number; cursor?: string }) =>
      call(`/v1/facts${query({ confirmed, limit, cursor })}`, z.object({ facts: z.array(FactSchema), next_cursor: Cursor })),
    getFact: (id: number) => call(`/v1/facts/${id}`, SingleFactSchema),
    // Bee creates every new fact unconfirmed; the owner confirms or deletes it in the Bee app.
    createFact: (text: string) => call("/v1/facts", CreatedFactSchema, { method: "POST", body: JSON.stringify({ text }) }),
    // pnpm forget (M3-T11). A 404 surfaces as BeeApiError.status, which forget counts as already gone.
    deleteTodo: async (id: number): Promise<void> => { await call(`/v1/todos/${id}`, z.unknown(), { method: "DELETE" }); },
    deleteFact: async (id: number): Promise<void> => { await call(`/v1/facts/${id}`, z.unknown(), { method: "DELETE" }); },
  };
}

export type BeeClient = ReturnType<typeof createBeeClient>;
