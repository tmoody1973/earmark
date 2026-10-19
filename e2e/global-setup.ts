import { clerkSetup } from "@clerk/testing/playwright";

export default async function globalSetup() {
  if (process.env.E2E_DEMO === "1") return; // the judge demo (decision 053): nobody signs in, so no Clerk testing token
  await clerkSetup();
}
