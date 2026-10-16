import { handleSongCapture } from "@/agent/lib/capture/songs";

// Public to Clerk (proxy.ts lets /api/capture/ past); handleSongCapture checks the bearer token itself.
export const maxDuration = 60;
export const POST = (req: Request) => handleSongCapture(req);
