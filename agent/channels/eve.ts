import { eveChannel } from "eve/channels/eve";
import { localDev, vercelOidc } from "eve/channels/auth";

// The agent's own HTTP API (/eve/v1/session…) has no browser client in Earmark: the garden is Next.js pages behind
// Clerk, the nightly/10-minute schedules are handler-form (no session), and Bee events enter through
// app/api/bee/events. So the walk is fail-closed on purpose: Vercel OIDC (our own deployments, the eve TUI) and
// localDev (ignored in production). The default placeholderAuth was dropped; anything else gets 401.
// /eve/v1/health stays public by design (eve skips the walk for it).
export default eveChannel({
  auth: [vercelOidc(), localDev()],
});
