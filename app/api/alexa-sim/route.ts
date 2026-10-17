import { auth } from "@clerk/nextjs/server";
import { isOwner } from "@/agent/lib/owner";
import { runTurn, SimInput } from "@/agent/lib/alexa/sim";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Owner check first (404, no hint), then a capped body. The service token never leaves the server.
export async function POST(req: Request): Promise<Response> {
  const { userId } = await auth();
  if (!isOwner(userId)) return new Response(null, { status: 404 });
  const parsed = SimInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad request" }, { status: 400 });
  const origin = new URL(req.url).origin;
  return Response.json(await runTurn({ ...parsed.data, origin }));
}
