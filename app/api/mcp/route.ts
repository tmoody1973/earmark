import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import { mcpConfigured, mcpIssuer, verifyServiceToken } from "@/agent/lib/mcp/oauth";
import { addToEarmarkedPlaylist, latestEpisode, readyIdeas, searchEarmarksTool, whatDidTheyRecommend } from "@/agent/lib/mcp/tools";

export const dynamic = "force-dynamic";

const reply = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

// Logs the tool name and error class only: never arguments, names, excerpts or tokens.
async function run(tool: string, fn: () => Promise<{ text: string }>) {
  try {
    return reply((await fn()).text);
  } catch (err) {
    console.error(`[mcp] tool=${tool} error=${err instanceof Error ? err.name : "unknown"}`);
    return { ...reply("Sorry, Earmark couldn't answer that just now."), isError: true };
  }
}

const readOnly = { readOnlyHint: true };

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "what_did_they_recommend",
      {
        title: "What did they recommend",
        description: "List what one person recommended to Tarik in a period. Person is a first name.",
        inputSchema: z.object({ person: z.string().min(1).max(40), period: z.enum(["week", "month", "all"]).default("month") }),
        annotations: readOnly,
      },
      (args) => run("what_did_they_recommend", () => whatDidTheyRecommend(args)),
    );
    server.registerTool(
      "ready_ideas",
      { title: "Ready ideas", description: "Ideas Tarik has mentioned three or more times.", inputSchema: z.object({}), annotations: readOnly },
      () => run("ready_ideas", () => readyIdeas()),
    );
    server.registerTool(
      "search_earmarks",
      {
        title: "Search earmarks",
        description: "Find a recommendation or idea by who said it, where, when (e.g. 'in September', 'last week') and what it was about.",
        inputSchema: z.object({ who: z.string().max(40).optional(), where: z.string().max(80).optional(), when: z.string().max(40).optional(), query: z.string().max(120).optional() }),
        annotations: readOnly,
      },
      (args) => run("search_earmarks", () => searchEarmarksTool(args)),
    );
    server.registerTool(
      "add_to_earmarked_playlist",
      {
        title: "Add to Earmarked playlist",
        description: "Add a recommended album, song or artist to Tarik's Earmarked Apple Music playlist.",
        inputSchema: z.object({ item: z.string().min(1).max(200) }),
      },
      (args) => run("add_to_earmarked_playlist", () => addToEarmarkedPlaylist(args)),
    );
    server.registerTool(
      "latest_episode",
      { title: "Latest episode", description: "The newest weekly Earmark recap episode.", inputSchema: z.object({}), annotations: readOnly },
      () => run("latest_episode", () => latestEpisode()),
    );
  },
  { serverInfo: { name: "earmark", version: "1.0.0" } },
);

// Missing/invalid/expired token -> 401 with the spec's WWW-Authenticate challenge (RFC 9728 resource_metadata).
// Unconfigured -> bare 503 (fail closed, no detail).
async function serve(req: Request): Promise<Response> {
  if (!mcpConfigured()) return new Response(null, { status: 503 });
  const authed = withMcpAuth(handler, verifyServiceToken, {
    required: true,
    resourceMetadataPath: "/.well-known/oauth-protected-resource",
    resourceUrl: mcpIssuer(),
  });
  return authed(req);
}

export { serve as GET, serve as POST, serve as DELETE };
