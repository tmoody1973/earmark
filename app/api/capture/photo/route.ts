import { handlePhotoCapture } from "@/agent/lib/capture/photos";

// Public to Clerk (proxy.ts lets /api/capture/ past); handlePhotoCapture checks the bearer token itself.
export const maxDuration = 60;
export const POST = (req: Request) => handlePhotoCapture(req);
