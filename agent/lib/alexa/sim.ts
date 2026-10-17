// The simulated Alexa+ agent turn: mint a service token, act as a real MCP client of Earmark's own /api/mcp,
// let a model call its tools, speak the answer with Polly. Nothing is stored. Logs carry error class names only.
import { createMCPClient } from "@ai-sdk/mcp";
import { generateText, isStepCount, type ToolSet } from "ai";
import { z } from "zod";
import { getEnv } from "../env";
import { chunkForPolly, synthesize } from "../episode/voice";
import { issueServiceToken } from "../mcp/oauth";

export const FALLBACK = "Sorry, I couldn't reach your garden just now.";
const MAX_SPOKEN_CHARS = 600;

const Turn = z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(600) });
export const SimInput = z.object({ question: z.string().trim().min(1).max(300), history: z.array(Turn).max(6) });
export interface TurnInput extends z.infer<typeof SimInput> { origin: string }
export interface TurnResult { answer: string; toolsUsed: string[]; audio?: string }

export interface SimDeps {
  mint: () => Promise<string>;
  connect: (url: string, token: string) => Promise<{ tools: () => Promise<Record<string, unknown>>; close: () => Promise<void> }>;
  generate: typeof generateText;
  synthesize: (chunks: string[]) => Promise<Uint8Array>;
  model: string;
}

const PERSONA = [
  "You are Alexa, answering Tarik out loud through his Earmark garden of recommendations people gave him.",
  "Always look things up with the tools; never guess. Answer in one to three short spoken sentences.",
  "Use first names only. Never read out URLs, ids or file names. Never say Tarik's own name; say \"you\".",
  "If the tools find nothing, say so plainly. No lists, no markdown, no emoji.",
].join(" ");

// Basic credentials from the same env the real token endpoint checks; server-side only, the browser never sees them.
async function mintToken(): Promise<string> {
  const id = encodeURIComponent(process.env.EARMARK_MCP_CLIENT_ID ?? "");
  const secret = encodeURIComponent(process.env.EARMARK_MCP_CLIENT_SECRET ?? "");
  const authorization = `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
  return (await issueServiceToken({ authorization, resource: null })).access_token;
}

const defaults = (): SimDeps => ({
  mint: mintToken,
  connect: (url, token) => createMCPClient({ transport: { type: "http", url, headers: { Authorization: `Bearer ${token}` } } }),
  generate: generateText,
  synthesize: (chunks) => synthesize(chunks),
  model: getEnv().EXTRACT_MODEL, // fast model: voice turns should feel quick
});

const toolNames = (steps: ReadonlyArray<{ toolCalls?: ReadonlyArray<{ toolName: string }> }>) =>
  [...new Set(steps.flatMap((s) => (s.toolCalls ?? []).map((c) => c.toolName)))];

async function speak(text: string, synth: SimDeps["synthesize"]): Promise<string | undefined> {
  try {
    return Buffer.from(await synth(chunkForPolly(text.slice(0, MAX_SPOKEN_CHARS)))).toString("base64");
  } catch (err) {
    console.error(`[alexa-sim] polly error=${err instanceof Error ? err.name : "unknown"}`);
    return undefined; // the page falls back to the browser's speechSynthesis
  }
}

export async function runTurn(input: TurnInput, deps?: SimDeps): Promise<TurnResult> {
  let client: Awaited<ReturnType<SimDeps["connect"]>> | undefined;
  try {
    const d = deps ?? defaults();
    client = await d.connect(`${input.origin}/api/mcp`, await d.mint());
    const result = await d.generate({
      model: d.model,
      instructions: PERSONA,
      tools: (await client.tools()) as ToolSet,
      stopWhen: isStepCount(4),
      messages: [...input.history.map((t) => ({ role: t.role, content: t.text })), { role: "user" as const, content: input.question }],
    });
    const answer = result.text.trim();
    if (!answer) return { answer: FALLBACK, toolsUsed: [] };
    const toolsUsed = toolNames(result.steps);
    console.log(`[alexa-sim] tools=${toolsUsed.join(",") || "none"} count=${toolsUsed.length}`);
    const audio = await speak(answer, d.synthesize);
    return audio ? { answer, toolsUsed, audio } : { answer, toolsUsed };
  } catch (err) {
    console.error(`[alexa-sim] turn error=${err instanceof Error ? err.name : "unknown"}`);
    return { answer: FALLBACK, toolsUsed: [] };
  } finally {
    await client?.close().catch(() => {});
  }
}
