import { z } from "zod";

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
  EMBED_MODEL: z.string().default("openai/text-embedding-3-small"),
  EARMARK_OWNER_CLERK_ID: z.string().optional(), // required by the web app only
  EARMARK_OWNER_FIRST_NAME: z.string().optional(), // garden owner: never credited as a recommender
  NOTION_TOKEN: z.string().optional(), // needed only to trash a Notion page (pnpm forget) until M3 Notion sync
});
export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;
export function getEnv(source: Record<string, string | undefined> = process.env): Env {
  if (source === process.env && cached) return cached;
  const parsed = EnvSchema.parse(source);
  if (source === process.env) cached = parsed;
  return parsed;
}

// Call-site read for the pipeline: tolerant of a partial env (unlike getEnv, which needs the full schema).
export function ownerFirstName(source: Record<string, string | undefined> = process.env): string | undefined {
  return source.EARMARK_OWNER_FIRST_NAME?.trim() || undefined;
}
