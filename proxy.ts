import { clerkMiddleware } from "@clerk/nextjs/server";
import { gate } from "./agent/lib/owner";

const NOT_YOURS = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Not your garden · Earmark</title>
<style>body{margin:0;background:#faf7f2;color:#1f1b16;font:1.125rem/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}main{max-width:36rem;margin:0 auto;padding:3rem 1rem}h1{font-size:1.75rem;margin:0 0 .5rem}p{margin:0 0 1rem}a{color:#8a3b12}a:focus-visible{outline:3px solid #8a3b12;outline-offset:2px}</style></head>
<body><main><h1>This isn't your garden</h1><p>Earmark is private to one person, and this account isn't them. Nothing here was shown to you.</p><p><a href="/sign-out">Sign out and try a different account</a></p></main></body></html>`;

// M1 scaffold: the whole app is private except sign-in, the Bee webhook and the eve channel (see isPublicPath).
export default clerkMiddleware(async (auth, req) => {
  const { userId } = await auth();
  const decision = gate(req.nextUrl.pathname, userId);
  if (decision === "sign-in") await auth.protect();
  if (decision === "forbid") {
    return new Response(NOT_YOURS, { status: 403, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
};
