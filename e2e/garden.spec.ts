import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test, type Page } from "@playwright/test";

// Both users live in the Clerk *development* instance. The owner is whoever EARMARK_OWNER_CLERK_ID names;
// the other account proves a signed-in stranger is refused. clerk.signIn mints a server-side sign-in token,
// so no email code or password is involved.
const OWNER_EMAIL = process.env.E2E_OWNER_EMAIL;
if (!OWNER_EMAIL) throw new Error("E2E_OWNER_EMAIL is not set. Add the owner's Clerk email to .env.local (see .env.example).");
const STRANGER_EMAIL = "earmark-test+clerk_test@example.com";
// Git-ignored (/test-results/): these can show real garden data, so they must never land in a tracked folder.
const SHOTS = "test-results/screens";
const HIDE_DEV_BADGE = "nextjs-portal { display: none !important; }";

async function signInAs(page: Page, emailAddress: string) {
  await setupClerkTestingToken({ page });
  await page.goto("/sign-in");
  await clerk.signIn({ page, emailAddress });
}

test("a signed-out visitor is sent to sign in", async ({ page }) => {
  await setupClerkTestingToken({ page });
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in/);
});

test("the owner sees the garden", async ({ page }, info) => {
  await signInAs(page, OWNER_EMAIL);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Earmark" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ideas" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Shelf" })).toBeVisible();

  // phone-first: nothing may push the page wider than the viewport
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  await page.addStyleTag({ content: HIDE_DEV_BADGE });
  await page.screenshot({ path: `${SHOTS}/m1-garden-${info.project.name}.png`, fullPage: true });
});

// Design screenshots for the shelf (M4-T2). SHOT_LABEL names the data set ("real", or "sample" when the dev server
// runs against the test branch seeded by scripts/seed-sample-shelf.ts). docs/design/screens/ is git-ignored.
test("the shelf renders a type-aware card for every tip", async ({ page }, info) => {
  const label = process.env.SHOT_LABEL ?? "real";
  const dir = "docs/design/screens";
  await signInAs(page, OWNER_EMAIL);
  await page.goto("/shelf");
  const cards = page.getByTestId("rec-card");
  await expect(cards.first()).toBeVisible();
  for (const card of await cards.all()) {
    await expect(card).toHaveAttribute("data-variant", /^(cover|artist|spine|map|tile|poster|note)$/);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  // every image has loaded or been swapped for its no-image state: none may be broken
  await page.evaluate(async () => {
    for (const img of Array.from(document.images)) { img.loading = "eager"; await img.decode().catch(() => {}); }
  });
  const broken = await page.evaluate(() => Array.from(document.images).filter((i) => i.complete && i.naturalWidth === 0).length);
  expect(broken).toBe(0);
  await page.addStyleTag({ content: HIDE_DEV_BADGE });
  const width = info.project.name === "phone" ? 390 : 1440;
  await page.screenshot({ path: `${dir}/m4-shelf-${label}-${width}.png`, fullPage: true });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Shelf" })).toBeVisible();
  await page.addStyleTag({ content: HIDE_DEV_BADGE });
  await page.screenshot({ path: `${dir}/m4-garden-${label}-${width}.png`, fullPage: true });
});

test("a signed-in non-owner is refused and sees no data", async ({ page }, info) => {
  await signInAs(page, STRANGER_EMAIL);
  const res = await page.goto("/");
  expect(res?.status()).toBe(403);
  await expect(page.getByRole("heading", { name: "This isn't your garden" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ideas" })).toHaveCount(0);
  await page.addStyleTag({ content: HIDE_DEV_BADGE });
  if (info.project.name === "desktop") await page.screenshot({ path: `${SHOTS}/m1-not-owner.png`, fullPage: true });

  // the way out: sign out, land on sign-in, and the garden is closed again
  await page.getByRole("link", { name: "Sign out and try a different account" }).click();
  await page.waitForFunction(() => (window as unknown as { Clerk?: { loaded?: boolean } }).Clerk?.loaded);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in/, { timeout: 15_000 });
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in/);
});
