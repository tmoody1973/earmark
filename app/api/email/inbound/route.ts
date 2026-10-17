import { after } from "next/server";
import { handleInboundEmail } from "@/agent/lib/capture/email";

// Public to Clerk (owner.ts lists /api/email/inbound); handleInboundEmail verifies the Resend signature itself.
export const maxDuration = 60;
export const POST = (req: Request) => handleInboundEmail(req, {}, after);
