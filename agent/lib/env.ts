import { z } from "zod";

const blankIsUnset = <T extends z.ZodType>(t: T) => z.preprocess((v) => (v === "" ? undefined : v), t);

const EnvSchema = z.object({
  BEE_TOKEN: z.string().min(1),
  BEE_API_BASE: z.string().url().default("https://api.developer.bee.amazon.dev"),
  DATABASE_URL: z.string().startsWith("postgres"),
  AI_GATEWAY_API_KEY: z.string().optional(), // not needed on Vercel (OIDC)
  EARMARK_WEBHOOK_SECRET: z.string().min(24),
  TRIAGE_MODEL: z.string().default("typesafe-ai/jev-1.13.0"),
  BENCHMARK_MODEL: z.string().default("openai/gpt-6-luna-decisions"),
  EXTRACT_MODEL: z.string().default("anthropic/claude-haiku-5.5"),
  WRITE_MODEL: z.string().default("anthropic/claude-sonnet-5.5"),
  PHOTO_DECISION_PROVIDER: z.enum(["gateway", "openai"]).default("gateway"),
  OPENAI_API_KEY: z.string().optional(), // only for PHOTO_DECISION_PROVIDER=openai
  EARMARK_CAPTURE_TOKEN: z.string().min(32).optional(), // bearer token for /api/capture/*; routes refuse everything while unset
  // Email-in (Resend inbound). Blank is the same as unset; the route refuses everything until all three are set.
  RESEND_API_KEY: blankIsUnset(z.string().min(1).optional()),
  RESEND_WEBHOOK_SECRET: blankIsUnset(z.string().min(1).optional()),
  EARMARK_OWNER_EMAIL: blankIsUnset(z.string().email().optional()), // only forwards from this address are accepted
  // Weekly episode (M5-T11). Polly credentials use EARMARK_-prefixed names: Vercel may reserve plain AWS_* names
  // on Functions, so these are passed to PollyClient explicitly. Blank is unset; voicing refuses until both keys are set.
  EARMARK_AWS_ACCESS_KEY_ID: blankIsUnset(z.string().min(1).optional()),
  EARMARK_AWS_SECRET_ACCESS_KEY: blankIsUnset(z.string().min(1).optional()),
  EARMARK_AWS_REGION: blankIsUnset(z.string().default("us-east-1")), // generative voices live in us-east-1
  POLLY_VOICE: blankIsUnset(z.string().default("Ruth")),
  EARMARK_FEED_TOKEN: blankIsUnset(z.string().min(32).optional()), // path secret of /feed/<token>; the route 404s while unset
  // MCP server (M5-T9): service-level OAuth client credentials. Blank is unset; the MCP routes fail closed (503) until all four are set.
  EARMARK_PUBLIC_BASE_URL: blankIsUnset(z.string().url().optional()), // production origin; token issuer + MCP resource base
  EARMARK_MCP_CLIENT_ID: blankIsUnset(z.string().min(8).optional()),
  EARMARK_MCP_CLIENT_SECRET: blankIsUnset(z.string().min(32).optional()),
  EARMARK_MCP_JWT_SECRET: blankIsUnset(z.string().min(32).optional()),
  EMBED_MODEL: z.string().default("openai/text-embedding-3-small"),
  EARMARK_OWNER_CLERK_ID: z.string().optional(), // required by the web app only
  EARMARK_OWNER_FIRST_NAME: z.string().optional(), // garden owner: never credited as a recommender
  NUDGE_RADIUS_M: z.coerce.number().int().min(50).max(2000).default(300), // FR-16 place nudges; Bee location accuracy is unknown
});
export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;
export function getEnv(source: Record<string, string | undefined> = process.env): Env {
  if (source === process.env && cached) return cached;
  const parsed = EnvSchema.parse(source);
  if (source === process.env) cached = parsed;
  return parsed;
}

export function requireEnv<K extends keyof Env>(key: K): NonNullable<Env[K]> {
  const value = getEnv()[key];
  if (value === undefined || value === null || value === "") {
    throw new Error(`${String(key)} is not set (see .env.example)`);
  }
  return value as NonNullable<Env[K]>;
}

// Call-site read for the pipeline: tolerant of a partial env (unlike getEnv, which needs the full schema).
export function ownerFirstName(source: Record<string, string | undefined> = process.env): string | undefined {
  return source.EARMARK_OWNER_FIRST_NAME?.trim() || undefined;
}
