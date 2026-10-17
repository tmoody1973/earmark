import { auth } from "@clerk/nextjs/server";
import { isOwner } from "@/agent/lib/owner";

// The existing inline owner check (same as app/garden/actions.ts), kept in one place so it is a one-line swap
// when a shared assertOwner lands. Server actions call it on every invocation; the page 404s non-owners.
export async function requireOwner(): Promise<void> {
  const { userId } = await auth();
  if (!isOwner(userId)) throw new Error("not found");
}
