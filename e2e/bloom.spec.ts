import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { neon } from "@neondatabase/serverless";
import { expect, test, type Page } from "@playwright/test";

// The live bloom (M4-T4), end to end on the Neon TEST branch: the dev server must run against it
// (DATABASE_URL=<TEST_DATABASE_URL value>; README). With the page open, a third mention is committed the way the
// save transaction writes it (mention + stage → ready + garden events in one transaction), and the page must bloom
// the plant in place, slide a chip into the New row and announce it, within one poll or two.
const OWNER_EMAIL = process.env.E2E_OWNER_EMAIL;
const TEST_DB = process.env.TEST_DATABASE_URL;
if (!OWNER_EMAIL || !TEST_DB) throw new Error("E2E_OWNER_EMAIL and TEST_DATABASE_URL must be set in .env.local");
const sql = neon(TEST_DB);
const MARK = "e2e-bloom"; // idea_clusters.summary of the rows this spec owns
const TITLE = "A weekly crate-digging segment"; // invented test data
const SHOTS = "docs/design/screens"; // git-ignored
const HIDE_DEV_BADGE = "nextjs-portal { display: none !important; }";

const line = (daysAgo: number, note: string) => {
  const d = new Date(Date.now() - daysAgo * 86_400_000);
  return { date: d.toISOString(), line: `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}: ${note}` };
};

// A sprouting idea (two mentions), pinned so it is the first plant on the home page whatever else the branch holds.
async function seedSprout(): Promise<number> {
  await sql`delete from idea_clusters where summary = ${MARK}`;
  const timeline = [line(9, "first heard"), line(2, "named the first two shops")];
  const [c] = await sql`insert into idea_clusters (title, summary, timeline, stage, pinned, mention_count, first_mentioned_at, last_mentioned_at)
    values (${TITLE}, ${MARK}, ${JSON.stringify(timeline)}, 'sprouting', true, 2, ${timeline[0]!.date}, ${timeline[1]!.date}) returning id`;
  for (const t of timeline) {
    await sql`insert into idea_mentions (cluster_id, excerpt, spoken_at, confidence, review_status, source)
      values (${c!.id}, 'one record shop a week, the owner picks a crate', ${t.date}, 0.9, 'accepted', 'ambient')`;
  }
  return Number(c!.id);
}

// What buildSaveQueries commits for a third mention on a separate occasion.
async function thirdMention(id: number) {
  const entry = line(0, "said it a third time: one crate per week");
  await sql.transaction([
    sql`insert into idea_mentions (cluster_id, excerpt, spoken_at, confidence, review_status, source)
      values (${id}, 'okay this is the third time, one crate a week', now(), 0.9, 'accepted', 'ambient')`,
    sql`update idea_clusters set mention_count = 3, stage = idea_stage_for(stage, 3), last_mentioned_at = now(),
      timeline = timeline || ${JSON.stringify([entry])}::jsonb, updated_at = now() where id = ${id}`,
    sql`insert into garden_events (kind, cluster_id) values ('mention', ${id}), ('bloom', ${id})`,
  ]);
}

async function signIn(page: Page) {
  await setupClerkTestingToken({ page });
  await page.goto("/sign-in");
  await clerk.signIn({ page, emailAddress: OWNER_EMAIL! });
}

// Layout shifts whose source is inside the garden of ideas (the bloom must not move a single card).
async function watchBedShifts(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __bedShift: number };
    w.__bedShift = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as Array<{ value: number; sources?: Array<{ node?: Node }> }>) {
        if (e.sources?.some((s) => s.node instanceof Element && s.node.closest(".idea-bed"))) w.__bedShift += e.value;
      }
    }).observe({ type: "layout-shift" });
  });
}

test.afterAll(async () => {
  await sql`delete from idea_clusters where summary = ${MARK}`;
});

test("a third mention blooms the plant in place, chips the New row and announces it", async ({ page }, info) => {
  const width = info.project.name === "phone" ? 390 : 1440;
  const id = await seedSprout();
  await signIn(page);
  await page.goto("/");
  await page.addStyleTag({ content: HIDE_DEV_BADGE });
  const plant = page.locator(`#garden [data-testid="plant"][data-cluster-id="${id}"]`);
  await expect(plant, "the dev server must read the TEST branch (see the spec header)").toHaveAttribute("data-level", "sprout");
  await expect(page.getByTestId("bloom-announcer")).toHaveText("");
  // on a phone the first card can sit under the tab bar: centre it, the New row stays in view above
  await plant.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await watchBedShifts(page);

  await thirdMention(id);

  await expect(plant).toHaveAttribute("data-level", "bloom", { timeout: 15_000 });
  await expect(plant).toHaveAttribute("data-bloom-from", "sprout"); // playing from where it was drawn
  await page.waitForTimeout(900); // mid-bloom: stems drawn, petals opening
  await page.screenshot({ path: `${SHOTS}/m4-bloom-mid-${width}.png` });
  await expect(plant).not.toHaveAttribute("data-bloom-from", /.*/, { timeout: 5_000 }); // landed and settled

  const chip = page.locator(`[data-testid="new-chip"][data-key="idea-${id}"]`);
  await expect(chip).toBeVisible();
  await expect(chip).toContainText(TITLE);
  await expect(chip).toContainText("Bloomed · 3 mentions");
  // the arrived chip is actually in sight, at the front of the row (not scrolled off its left edge)
  await expect.poll(async () => {
    const [c, r] = await Promise.all([chip.boundingBox(), page.locator(".new-chips").boundingBox()]);
    return c && r ? Math.round(c.x - r.x) : -1;
  }).toBeLessThanOrEqual(16);
  await expect.poll(async () => (await chip.boundingBox())?.x ?? -1).toBeGreaterThanOrEqual(0);
  await expect(page.getByTestId("bloom-announcer")).toHaveText(`${TITLE} bloomed — mentioned 3 times.`);
  const card = page.locator(".idea-card").filter({ has: page.locator(`[data-cluster-id="${id}"]`) });
  await expect(card.locator(".idea-meta")).toHaveText(/Bloomed · 3 mentions/);
  expect(await page.evaluate(() => (window as unknown as { __bedShift: number }).__bedShift)).toBe(0);
  await page.screenshot({ path: `${SHOTS}/m4-bloom-end-${width}.png` });

  // 320 px: header, search, New row and tabs still fit
  await page.setViewportSize({ width: 320, height: 720 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

test("reduced motion: the plant jumps to bloom with nothing animating", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const id = await seedSprout();
  await signIn(page);
  await page.goto("/");
  const plant = page.locator(`#garden [data-testid="plant"][data-cluster-id="${id}"]`);
  await expect(plant).toHaveAttribute("data-level", "sprout");
  await thirdMention(id);
  await expect(plant).toHaveAttribute("data-level", "bloom", { timeout: 15_000 });
  await expect(plant).not.toHaveAttribute("data-bloom-from", /.*/);
  expect(await plant.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
  await expect(page.getByTestId("bloom-announcer")).toHaveText(`${TITLE} bloomed — mentioned 3 times.`);
  const chip = page.locator(`[data-testid="new-chip"][data-key="idea-${id}"]`);
  await expect(chip).toBeVisible();
  expect(await chip.evaluate((el) => el.closest("li")!.getAnimations().length)).toBe(0);
});

test("search narrows the page by title and first name, and the tabs mark where you are", async ({ page }) => {
  const id = await seedSprout();
  await signIn(page);
  await page.goto("/");
  const plantItem = page.locator("#garden .idea-bed > li").filter({ has: page.locator(`[data-cluster-id="${id}"]`) });
  await expect(plantItem).toBeVisible();
  const search = page.getByRole("searchbox", { name: "Search what you heard" });
  await search.fill("crate-digging");
  await expect(plantItem).toBeVisible();
  await expect(page.locator("#garden-q-status")).toHaveText(/on this page/);
  await search.fill("zzzz no such thing");
  await expect(plantItem).toBeHidden();
  await expect(page.locator("#garden-q-status")).toHaveText("Nothing here matches “zzzz no such thing”.");
  await search.fill("");
  await expect(plantItem).toBeVisible();

  const nav = page.getByRole("navigation", { name: "Garden sections" });
  await expect(nav.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
  await nav.getByRole("link", { name: "Shelf" }).click();
  await expect(page).toHaveURL(/\/shelf$/);
  await expect(nav.getByRole("link", { name: "Shelf" })).toHaveAttribute("aria-current", "page");
  for (const box of await nav.getByRole("link").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) {
    expect(box).toBeGreaterThanOrEqual(44);
  }
});

test("the poller rests while the tab is hidden", async ({ page }) => {
  await signIn(page);
  let polls = 0;
  page.on("request", (r) => { if (r.url().includes("/api/garden/blooms")) polls++; });
  await page.goto("/");
  await expect.poll(() => polls, { timeout: 12_000 }).toBeGreaterThan(0); // polling while visible
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(500); // a poll already in flight may land
  const atHide = polls;
  await page.waitForTimeout(11_000); // two poll intervals
  expect(polls).toBe(atHide);
});
