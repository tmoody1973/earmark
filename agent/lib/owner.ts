// Anything under /api/bee/ or /eve/v1/ bypasses Clerk: a new route there must carry its own auth.
// /sign-out is public so a signed-in non-owner (refused everywhere else) can leave.
// M5 paths below do their own auth (bearer token, webhook signature, unguessable token) or are intentionally public pages.
// /about is static and reads nothing from the database (tests/app/about.test.ts).
import { isDemo } from "./demo";

const PUBLIC = [
  /^\/sign-in(?:\/|$)/, /^\/sign-out$/, /^\/api\/bee\//, /^\/eve\/v1\//,
  /^\/api\/capture\//, /^\/api\/email\/inbound$/, /^\/api\/mcp$/,
  /^\/api\/oauth\/token$/, /^\/\.well-known\//, /^\/r\//, /^\/s\//,
  /^\/feed\//, /^\/privacy$/, /^\/terms$/, /^\/about$/,
];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC.some((re) => re.test(pathname));
}

// Clerk's allowlist is a paid production feature, so the single-owner check lives here.
// Reads process.env directly (not getEnv): the web app needs neither Bee nor database vars to decide this.
// The judge demo (decision 053) treats everyone as the viewer of its sample garden; proxy.ts refuses its writes.
export function isOwner(userId: string | null | undefined, owner = process.env.EARMARK_OWNER_CLERK_ID): boolean {
  if (isDemo()) return true;
  return !!owner && !!userId && userId === owner;
}

export type GateDecision = "allow" | "sign-in" | "forbid";

/** What proxy.ts does with a request: public paths pass, signed-out visitors sign in, non-owners are refused. */
export function gate(pathname: string, userId: string | null | undefined, owner = process.env.EARMARK_OWNER_CLERK_ID): GateDecision {
  if (isPublicPath(pathname) || isDemo()) return "allow"; // the demo needs no sign-in
  if (!userId) return "sign-in";
  return isOwner(userId, owner) ? "allow" : "forbid";
}
