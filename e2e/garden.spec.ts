import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { neon } from "@neondatabase/serverless";
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

// Lazy images below the fold would be blank in a full-page shot: load every one (or let it fail to its no-image state).
async function loadImages(page: Page) {
  await page.evaluate(async () => {
    for (const img of Array.from(document.images)) { img.loading = "eager"; await img.decode().catch(() => {}); }
  });
}

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
  await loadImages(page);
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
    await expect(card).toHaveAttribute("data-variant", /^(cover|artist|spine|map|tile|poster|screen|note)$/);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  // every image has loaded or been swapped for its no-image state: none may be broken
  await loadImages(page);
  const broken = await page.evaluate(() => Array.from(document.images).filter((i) => i.complete && i.naturalWidth === 0).length);
  expect(broken).toBe(0);
  await page.addStyleTag({ content: HIDE_DEV_BADGE });
  const width = info.project.name === "phone" ? 390 : 1440;
  await loadImages(page);
  await page.screenshot({ path: `${dir}/m4-shelf-${label}-${width}.png`, fullPage: true });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Shelf" })).toBeVisible();
  await page.addStyleTag({ content: HIDE_DEV_BADGE });
  await loadImages(page);
  await page.screenshot({ path: `${dir}/m4-garden-${label}-${width}.png`, fullPage: true });
});

// Idea plants and the idea page (M4-T3). With SHOT_LABEL=sample (dev server on the test branch seeded by
// scripts/seed-sample-ideas.ts) it visits one idea per plant level plus the dismissed one; with real data, the first.
test("ideas grow as plants on the garden, and each opens its own page", async ({ page }, info) => {
  const label = process.env.SHOT_LABEL ?? "real";
  const dir = "docs/design/screens";
  const width = info.project.name === "phone" ? 390 : 1440;
  const noOverflow = async () =>
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await signInAs(page, OWNER_EMAIL);

  await page.goto("/");
  const homePlants = page.locator("#garden").getByTestId("plant");
  await expect(homePlants.first()).toBeVisible();
  expect(await homePlants.count()).toBeLessThanOrEqual(6);
  for (const p of await homePlants.all()) {
    await expect(p).toHaveAttribute("data-cluster-id", /^\d+$/);
    await expect(p).toHaveAttribute("data-level", /^(seed|sprout|bloom|fruit|harvested)$/);
  }
  await noOverflow();
  await page.addStyleTag({ content: HIDE_DEV_BADGE });
  await loadImages(page);
  await page.screenshot({ path: `${dir}/m4-ideas-home-${label}-${width}.png`, fullPage: true });

  await page.goto("/garden");
  const byLevel = new Map<string, string>();
  for (const card of await page.locator(".idea-card").all()) {
    const level = (await card.getByTestId("plant").getAttribute("data-level"))!;
    if (!byLevel.has(level)) byLevel.set(level, (await card.locator("a.idea-link").getAttribute("href"))!);
  }
  const visits = label === "sample" ? [...byLevel] : [...byLevel].slice(0, 1);
  if (label === "sample") {
    const [d] = await neon(process.env.TEST_DATABASE_URL!)`select id from idea_clusters where summary = 'sample-ideas' and stage = 'dismissed'`;
    if (d) visits.push(["dismissed", `/ideas/${d.id}`]);
  }
  expect(visits.length).toBeGreaterThan(0);
  for (const [level, href] of visits) {
    await page.goto(href);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "How it grew" })).toBeVisible();
    await expect(page.locator(".idea-head").getByTestId("plant")).toHaveAttribute("role", "img");
    // timeline lines in date order, oldest first
    const dates = await page.locator(".growth > li").evaluateAll((els) => els.map((e) => e.getAttribute("data-date")!));
    expect(dates).toEqual([...dates].sort());
    // excerpts stay folded until asked for
    const first = page.locator(".growth details").first();
    if (await first.count()) {
      await expect(first.locator("blockquote")).toBeHidden();
      await first.locator("summary").click();
      await expect(first.locator("blockquote")).toBeVisible();
    }
    await noOverflow();
    await page.addStyleTag({ content: HIDE_DEV_BADGE });
    await loadImages(page);
    await page.screenshot({ path: `${dir}/m4-idea-${label}-${level}-${width}.png`, fullPage: true });
  }
  // 320 px still works, and the bloom dot never wraps away from its stage word
  await page.setViewportSize({ width: 320, height: 800 });
  const dotOnStageLine = async () => {
    for (const meta of await page.locator(".idea-meta").filter({ has: page.locator(".bloom-dot") }).all()) {
      const dot = (await meta.locator(".bloom-dot").boundingBox())!;
      const word = (await meta.locator(".idea-stage").boundingBox())!;
      expect(dot.y).toBeGreaterThanOrEqual(word.y - 2);
      expect(dot.y + dot.height).toBeLessThanOrEqual(word.y + word.height + 2);
    }
  };
  await page.goto("/garden");
  await noOverflow();
  await dotOnStageLine();
  for (const [, href] of visits) {
    await page.goto(href);
    await noOverflow();
    await dotOnStageLine();
  }
});

test("an idea that does not exist is a 404", async ({ page }) => {
  await signInAs(page, OWNER_EMAIL);
  expect((await page.goto("/ideas/999999999"))?.status()).toBe(404);
  expect((await page.goto("/ideas/not-a-number"))?.status()).toBe(404);
});

// Needs a linked place card with a map (the sample set has one); real data may not, so it skips there.
test("on a linked place card, the map credit is its own click target above the card link", async ({ page }) => {
  await signInAs(page, OWNER_EMAIL);
  await page.goto("/shelf");
  const card = page.locator('[data-variant="map"].rec-card--linked').filter({ has: page.locator(".rec-osm") }).first();
  test.skip((await card.count()) === 0, "no linked place card with a map in this data set");
  const credit = card.locator(".rec-osm");
  await credit.scrollIntoViewIfNeeded();
  const hit = async (x: number, y: number) =>
    page.evaluate(([px, py]) => {
      const el = document.elementFromPoint(px, py);
      return el?.classList.contains("rec-osm") ? "credit" : el?.classList.contains("rec-link") ? "card-link" : el?.tagName ?? "none";
    }, [x, y]);
  const c = (await credit.boundingBox())!;
  expect(await hit(c.x + c.width / 2, c.y + c.height / 2)).toBe("credit");
  const art = (await card.locator(".rec-art").boundingBox())!;
  expect(await hit(art.x + 12, art.y + 12)).toBe("card-link"); // the rest of the map still opens the tip
  await credit.click({ trial: true }); // Playwright's own hit-target check
  await expect(credit).toHaveAttribute("href", "https://www.openstreetmap.org/copyright");
});

// The sample set's "Range" cover URL 404s on purpose: the card must show its spine, never a broken image.
test("a cover that fails to load falls back to the designed no-image state", async ({ page }) => {
  await signInAs(page, OWNER_EMAIL);
  await page.goto("/shelf");
  const card = page.getByTestId("rec-card").filter({ has: page.getByRole("heading", { name: "Range", exact: true }) });
  test.skip((await card.count()) === 0, "the sample set is not loaded");
  await expect(card.locator(".jacket")).toBeVisible();
  await expect(card.locator("img")).toHaveCount(0);
});

test("a signed-in non-owner is refused and sees no data", async ({ page }, info) => {
  await signInAs(page, STRANGER_EMAIL);
  const res = await page.goto("/");
  expect(res?.status()).toBe(403);
  await expect(page.getByRole("heading", { name: "This isn't your garden" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ideas" })).toHaveCount(0);
  await page.addStyleTag({ content: HIDE_DEV_BADGE });
  await loadImages(page);
  if (info.project.name === "desktop") await page.screenshot({ path: `${SHOTS}/m1-not-owner.png`, fullPage: true });

  // the way out: sign out, land on sign-in, and the garden is closed again
  await page.getByRole("link", { name: "Sign out and try a different account" }).click();
  await page.waitForFunction(() => (window as unknown as { Clerk?: { loaded?: boolean } }).Clerk?.loaded);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in/, { timeout: 15_000 });
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in/);
});
