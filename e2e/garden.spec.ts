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
    await expect(card).toHaveAttribute("data-variant", /^(cover|artist|spine|map|tile|poster|note)$/);
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

// The taste ledger (M4-T5). With SHOT_LABEL=sample the dev server reads the test branch seeded by
// scripts/seed-sample-shelf.ts then scripts/seed-sample-people.ts. Read-only: nothing here writes.
test("People lists who gave tips, newest first, and each person opens to their own tips", async ({ page }, info) => {
  const label = process.env.SHOT_LABEL ?? "real";
  const dir = "docs/design/screens";
  const width = info.project.name === "phone" ? 390 : 1440;
  const noOverflow = async () =>
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  const nav = page.getByRole("navigation", { name: "Garden sections" });
  await signInAs(page, OWNER_EMAIL);

  await page.goto("/");
  await nav.getByRole("link", { name: "People" }).click();
  await expect(page).toHaveURL(/\/people$/);
  await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "People" })).toHaveAttribute("aria-current", "page");

  const rows = page.getByTestId("ledger-row");
  await expect(rows.first()).toBeVisible();
  const last = await rows.evaluateAll((els) => els.map((e) => e.getAttribute("data-last-tip")!));
  expect(last).toEqual([...last].sort().reverse()); // most recent tip first
  const names = await rows.locator(".ledger-name").allTextContents();
  const owner = process.env.EARMARK_OWNER_FIRST_NAME?.trim().toLowerCase();
  if (owner) expect(names.map((n) => n.toLowerCase())).not.toContain(owner);
  for (const row of await rows.all()) await expect(row.getByRole("link")).toHaveAttribute("href", /^\/people\/\d+$/);
  if (label === "sample") await expect(page.getByTestId("ledger-unknown")).toContainText(/not sure who/);
  const link = rows.first().getByRole("link");
  expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await noOverflow();
  await page.addStyleTag({ content: HIDE_DEV_BADGE });
  await page.screenshot({ path: `${dir}/m4-people-${label}-${width}.png`, fullPage: true });

  const taste = (await rows.first().locator(".ledger-taste").textContent())!;
  await link.click();
  await expect(page).toHaveURL(/\/people\/\d+$/);
  await expect(page.getByRole("heading", { level: 1, name: names[0], exact: true })).toBeVisible();
  await expect(page.locator(".person-head p")).toHaveText(taste);
  await expect(nav.getByRole("link", { name: "People" })).toHaveAttribute("aria-current", "true");
  const cards = page.getByTestId("rec-card");
  await expect(cards).toHaveCount(Number(taste.match(/^(\d+) tips?/)![1])); // the count is the cards shown
  await expect(page.locator(".rec-from")).toHaveCount(0); // their own page: no "from Ann" on every card
  await noOverflow();
  await page.addStyleTag({ content: HIDE_DEV_BADGE });
  await loadImages(page);
  await page.screenshot({ path: `${dir}/m4-person-${label}-${width}.png`, fullPage: true });

  await page.setViewportSize({ width: 320, height: 800 });
  await noOverflow();
  await page.locator(".person-back").click();
  await expect(page).toHaveURL(/\/people$/);
  await noOverflow();
});

test("a person who does not exist is a 404, and a stranger never sees People", async ({ page }) => {
  await signInAs(page, OWNER_EMAIL);
  expect((await page.goto("/people/999999999"))?.status()).toBe(404);
  expect((await page.goto("/people/not-a-number"))?.status()).toBe(404);
  await clerk.signOut({ page });
  await signInAs(page, STRANGER_EMAIL);
  expect((await page.goto("/people"))?.status()).toBe(403);
  await expect(page.getByTestId("ledger-row")).toHaveCount(0);
});

// The Maybe? pile (M4-T5b, decision 025). Writes, so TEST branch only: it seeds its own invented tips (raw_text =
// 'sample-maybe', re-runnable) and is skipped on a read-only real-data run. Rosa has one sure tip and two maybes;
// Juniper has only a maybe, so no page.
test("Maybe?: Keep moves a tip to the Shelf, Not a tip clears it, People never counts maybes", async ({ page }, info) => {
  test.skip(process.env.E2E_REAL === "1", "writes: test branch only");
  const sql = neon(process.env.TEST_DATABASE_URL!);
  const width = info.project.name === "phone" ? 390 : 1440;
  const dir = "docs/design/screens";
  const noOverflow = async () =>
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

  await sql`delete from recommendations where raw_text = 'sample-maybe'`;
  const person = async (name: string) =>
    (await sql`insert into recommenders (first_name) values (${name})
      on conflict (first_name_key) do update set first_name = excluded.first_name returning id`)[0].id as number;
  const rosa = await person("Rosa");
  const juniper = await person("Juniper");
  const tips: Array<[string, string, string | null, number | null, string, string | null]> = [
    ["artist", "Tinariwen", null, rosa, "new", "Desert blues. Start with Amassakoul."],
    ["book", "The Remains of the Day", "Kazuo Ishiguro", rosa, "needs_review", "Quiet and devastating. You'll finish it in a weekend."],
    ["other", "Weekly standup board", null, rosa, "needs_review", null],
    ["album", "Solar Power", "Lorde", juniper, "needs_review", null],
    ["artist", "Hania Rani", null, null, "needs_review", "Piano for late nights."],
  ];
  let minute = 0;
  for (const [type, name, creator, who, status, why] of tips) {
    await sql`insert into recommendations
      (type, raw_text, canonical_name, creator, recommender_id, context_summary, excerpt, said_at, source, status, confidence)
      values (${type}, 'sample-maybe', ${name}, ${creator}, ${who}, ${why}, 'sample excerpt',
        now() - make_interval(mins => ${minute++}), 'ambient', ${status}, ${status === "new" ? 0.95 : 0.75})`;
  }

  await signInAs(page, OWNER_EMAIL);
  const maybe = page.locator("#maybe");
  const card = (name: string) => page.getByTestId("maybe-card").filter({ has: page.getByRole("heading", { name, exact: true }) });
  const shelfCard = (name: string) => page.getByTestId("rec-card").filter({ has: page.getByRole("heading", { name, exact: true }) });

  // People: maybes never count, and a person whose only tip is a maybe has no page
  await page.goto(`/people/${rosa}`);
  await expect(page.locator(".person-head p")).toHaveText(/^1 tip ·/);
  await expect(page).toHaveTitle("Rosa · Earmark");
  expect((await page.goto(`/people/${juniper}`))?.status()).toBe(404);

  // Home shows the row below the shelf
  await page.goto("/");
  await expect(maybe.getByRole("heading", { name: "Maybe?" })).toBeVisible();
  await expect(maybe.getByTestId("maybe-card").first()).toBeVisible();
  await page.addStyleTag({ content: HIDE_DEV_BADGE });
  await loadImages(page);
  await page.screenshot({ path: `${dir}/m4-maybe-home-${width}.png`, fullPage: true });

  await page.goto("/shelf");
  await expect(maybe.getByText("Earmark wasn’t sure about these.")).toBeVisible();
  await expect(card("The Remains of the Day")).toBeVisible();
  await expect(shelfCard("The Remains of the Day")).toHaveCount(0); // a maybe is not on the shelf
  for (const b of await maybe.getByRole("button").all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await noOverflow();
  await page.addStyleTag({ content: HIDE_DEV_BADGE });
  await loadImages(page);
  await page.screenshot({ path: `${dir}/m4-maybe-shelf-${width}.png`, fullPage: true });

  // Keep: gone from Maybe at once, announced, focus moves on, and it lands on the shelf
  await card("The Remains of the Day").getByRole("button", { name: "Keep" }).click();
  await expect(card("The Remains of the Day")).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText("Kept: The Remains of the Day");
  expect(await page.evaluate(() => document.activeElement?.id ?? "")).toMatch(/^maybe-\d+-keep$/);
  await expect(shelfCard("The Remains of the Day")).toBeVisible();

  // Not a tip: gone, and stays gone
  await card("Weekly standup board").getByRole("button", { name: "Not a tip" }).click();
  await expect(card("Weekly standup board")).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText("Removed: Weekly standup board");
  await page.reload();
  await expect(card("Weekly standup board")).toHaveCount(0);
  await expect(shelfCard("Weekly standup board")).toHaveCount(0);
  await expect(shelfCard("The Remains of the Day")).toBeVisible();

  const rows = await sql`select canonical_name, status, user_verdict, user_verdict_at is not null as at
    from recommendations where raw_text = 'sample-maybe' order by canonical_name`;
  expect(rows.map((r) => [r.canonical_name, r.status, r.user_verdict, r.at])).toEqual([
    ["Hania Rani", "needs_review", null, false],
    ["Solar Power", "needs_review", null, false],
    ["The Remains of the Day", "new", "kept", true],
    ["Tinariwen", "new", null, false],
    ["Weekly standup board", "dismissed", "not_a_tip", true],
  ]);

  // the kept tip now counts for Rosa; the cleared one never did
  await page.goto(`/people/${rosa}`);
  await expect(page.locator(".person-head p")).toHaveText(/^2 tips ·/);
  await expect(page.getByTestId("rec-card")).toHaveCount(2);

  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/shelf");
  await expect(card("Hania Rani")).toBeVisible();
  await noOverflow();
});
