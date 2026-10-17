import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { neon } from "@neondatabase/serverless";
import { expect, test, type Page } from "@playwright/test";

// The live bloom (M4-T4), end to end on the Neon TEST branch (playwright.config.ts starts the dev server on it and
// the startup guard refuses anything else). With the page open, a third mention is committed the way the
// save transaction writes it (mention + stage → ready + garden events in one transaction), and the page must bloom
// the plant in place, slide a chip into the New row and announce it, within one poll or two.
const OWNER_EMAIL = process.env.E2E_OWNER_EMAIL;
const TEST_DB = process.env.TEST_DATABASE_URL;
if (!OWNER_EMAIL || !TEST_DB) throw new Error("E2E_OWNER_EMAIL and TEST_DATABASE_URL must be set in .env.local");
const sql = neon(TEST_DB);
// It writes (seeds and third mentions), so it never runs in a read-only real-data run.
test.skip(process.env.E2E_REAL === "1", "writes the test branch; real-data runs (E2E_REAL=1) are read-only");
const MARK = "e2e-bloom"; // idea_clusters.summary / recommendations.raw_text of the rows this spec owns
const TITLE = "A weekly crate-digging segment"; // invented test data
const SHOTS = "docs/design/screens"; // git-ignored
const HIDE_DEV_BADGE = "nextjs-portal { display: none !important; }";
const ISO_NOW = (offset = "0 seconds") =>
  sql`select to_char((now() - ${offset}::interval) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as t`.then((r) => String(r[0]!.t));

const line = (daysAgo: number, note: string) => {
  const d = new Date(Date.now() - daysAgo * 86_400_000);
  return { date: d.toISOString(), line: `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}: ${note}` };
};

// An idea at `count` mentions, pinned so it is the first plant on the home page whatever else the branch holds.
async function seedIdea(count: 1 | 2 = 2): Promise<number> {
  await sql`delete from idea_clusters where summary = ${MARK}`;
  const timeline = [line(9, "first heard"), line(2, "named the first two shops")].slice(0, count);
  const [c] = await sql`insert into idea_clusters (title, summary, timeline, stage, pinned, mention_count, first_mentioned_at, last_mentioned_at)
    values (${TITLE}, ${MARK}, ${JSON.stringify(timeline)}, idea_stage_for('compost', ${count}), true, ${count},
      ${timeline[0]!.date}, ${timeline.at(-1)!.date}) returning id`;
  for (const t of timeline) {
    await sql`insert into idea_mentions (cluster_id, excerpt, spoken_at, confidence, review_status, source)
      values (${c!.id}, 'one record shop a week, the owner picks a crate', ${t.date}, 0.9, 'accepted', 'ambient')`;
  }
  return Number(c!.id);
}

// What buildSaveQueries commits for one more mention on a separate occasion (+ 'bloom' when it reaches ready).
async function mentionAgain(id: number) {
  const entry = line(0, "said it again: one crate per week");
  const [c] = await sql`select mention_count from idea_clusters where id = ${id}`;
  const n = Number(c!.mention_count) + 1;
  await sql.transaction([
    sql`insert into idea_mentions (cluster_id, excerpt, spoken_at, confidence, review_status, source)
      values (${id}, 'okay I keep saying it, one crate a week', now(), 0.9, 'accepted', 'ambient')`,
    sql`update idea_clusters set mention_count = ${n}, stage = idea_stage_for(stage, ${n}), last_mentioned_at = now(),
      timeline = timeline || ${JSON.stringify([entry])}::jsonb, updated_at = now() where id = ${id}`,
    n === 3
      ? sql`insert into garden_events (kind, cluster_id) values ('mention', ${id}), ('bloom', ${id})`
      : sql`insert into garden_events (kind, cluster_id) values ('mention', ${id})`,
  ]);
}

// Exactly four tips new since "last time" (visit record + four tips caught after it, on the database's clock).
async function seedFourNewTips() {
  await sql`delete from recommendations where raw_text = ${MARK}`;
  const before = await ISO_NOW("5 seconds");
  const now = await ISO_NOW();
  await sql`insert into sync_cursors (name, cursor) values ('garden_visit', ${JSON.stringify({ seenBefore: before, lastVisit: now })})
    on conflict (name) do update set cursor = excluded.cursor, updated_at = now()`;
  for (const [i, name] of ["Test tip one", "Test tip two", "Test tip three", "Test tip four"].entries()) {
    await sql`insert into recommendations (type, raw_text, canonical_name, excerpt, said_at, source, confidence, status)
      values ('book', ${MARK}, ${name}, 'read this one', now() - ${`${i} seconds`}::interval, 'ambient', 0.9, 'new')`;
  }
}

async function signIn(page: Page) {
  await setupClerkTestingToken({ page });
  await page.goto("/sign-in");
  await clerk.signIn({ page, emailAddress: OWNER_EMAIL! });
}

// The page's total layout-shift score from now on, counting only shifts without recent input (what CLS counts).
async function watchShifts(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __shift: number; __shiftFrom: string[] };
    w.__shift = 0;
    w.__shiftFrom = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as Array<{ value: number; hadRecentInput: boolean; sources?: Array<{ node?: Node }> }>) {
        if (e.hadRecentInput) continue;
        w.__shift += e.value;
        for (const s of e.sources ?? []) {
          const el = s.node instanceof Element ? s.node : s.node?.parentElement;
          w.__shiftFrom.push(`${el?.tagName}.${el?.className} "${(s.node?.textContent ?? "").slice(0, 24)}"`);
        }
      }
    }).observe({ type: "layout-shift" });
  });
}
const shiftScore = (page: Page) =>
  page.evaluate(() => { const w = window as unknown as { __shift: number; __shiftFrom: string[] }; return { score: w.__shift, from: w.__shiftFrom }; });
// The total score. One source is allowed: the card's own words changing at 1.0 s ("Sprouting · 2" → "● Bloomed · 3")
// move the count a few px (≈0.00003). Everything else (cards, chips, rows, "See all") must not move at all.
async function expectNoShift(page: Page) {
  const { score, from } = await shiftScore(page);
  // the meta line's own words, including the pinned seed's "Top of mind" part that follows them (M4-T9)
  const other = from.filter((s) => !s.startsWith("P.idea-meta ") && !s.startsWith("SPAN.idea-meta-part "));
  expect(other, "nothing but the changed meta words may move").toEqual([]);
  expect(score, `layout shifts from: ${from.join(", ")}`).toBeLessThan(0.001);
}

// Holds every running animation at `ms` into its timeline for a frame tied to animation time, then lets go.
async function photographAt(page: Page, ms: number, path: string) {
  await page.evaluate((t) => { for (const a of document.getAnimations()) { a.pause(); a.currentTime = t; } }, ms);
  await page.screenshot({ path });
  await page.evaluate(() => { for (const a of document.getAnimations()) a.play(); });
}

const plantOf = (page: Page, id: number) => page.locator(`#garden [data-testid="plant"][data-cluster-id="${id}"]`);
const chipOf = (page: Page, id: number) => page.locator(`[data-testid="new-chip"][data-key="idea-${id}"]`);

test.afterAll(async () => {
  await sql`delete from idea_clusters where summary = ${MARK}`;
  await sql`delete from recommendations where raw_text = ${MARK}`;
});

test("a third mention blooms the plant in place, chips the New row and announces it", async ({ page }, info) => {
  const width = info.project.name === "phone" ? 390 : 1440;
  const id = await seedIdea(2);
  await signIn(page);
  await page.goto("/");
  await page.addStyleTag({ content: HIDE_DEV_BADGE });
  const plant = plantOf(page, id);
  await expect(plant, "the seeded idea must be on the page (the server reads the TEST branch)").toHaveAttribute("data-level", "sprout");
  await expect(page.getByTestId("bloom-announcer")).toHaveText("");
  // on a phone the first card can sit under the tab bar: centre it, the New row stays in view above
  await plant.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await watchShifts(page);
  const card = page.locator(".idea-card").filter({ has: page.locator(`[data-cluster-id="${id}"]`) });
  const meta = card.locator(".idea-meta");

  await mentionAgain(id);

  await expect(plant).toHaveAttribute("data-level", "bloom", { timeout: 15_000 });
  await expect(plant).toHaveAttribute("data-bloom-from", "sprout"); // playing from where it was drawn
  await expect(meta).toHaveText(/Sprouting · 2 mentions/); // the words wait for the flower
  await page.waitForTimeout(1_050);
  await photographAt(page, 1_200, `${SHOTS}/m4-bloom-mid-${width}.png`); // petals opening, by animation time
  await expect(meta).toHaveText(/Bloomed · 3 mentions/);
  await expect(plant).not.toHaveAttribute("data-bloom-from", /.*/, { timeout: 5_000 }); // landed and settled

  const chip = chipOf(page, id);
  await expect(chip).toBeVisible();
  await expect(chip).toContainText(TITLE);
  await expect(chip).toContainText("Bloomed · 3 mentions");
  // the arrived chip is actually in sight, at the front of the row (not scrolled off its left edge)
  await expect.poll(async () => {
    const [c, r] = await Promise.all([chip.boundingBox(), page.locator(".new-chips").boundingBox()]);
    return c && r ? Math.round(c.x - r.x) : -1;
  }).toBeLessThanOrEqual(16);
  await expect(chip.locator("xpath=..")).not.toHaveClass(/is-live/); // landed once: never replays
  await expect(page.getByTestId("bloom-announcer")).toHaveText(`${TITLE} bloomed — mentioned 3 times.`);
  await expectNoShift(page);
  await page.screenshot({ path: `${SHOTS}/m4-bloom-end-${width}.png` });

  // 320 px: header, search, New row and tabs still fit
  await page.setViewportSize({ width: 320, height: 720 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

test("starting from four new chips, the fifth (and its See all) moves nothing", async ({ page }) => {
  const id = await seedIdea(2);
  await seedFourNewTips();
  await signIn(page);
  await page.goto("/");
  await expect(page.getByTestId("new-chip")).toHaveCount(4);
  await expect(page.getByRole("button", { name: "See all" })).toHaveCount(0);
  await plantOf(page, id).evaluate((el) => el.scrollIntoView({ block: "center" }));
  await watchShifts(page);
  await mentionAgain(id);
  await expect(chipOf(page, id)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("new-chip")).toHaveCount(5);
  await expect(page.getByRole("button", { name: "See all" })).toBeVisible();
  await expect(plantOf(page, id)).not.toHaveAttribute("data-bloom-from", /.*/, { timeout: 5_000 });
  await expectNoShift(page);
});

test("reduced motion: the plant jumps to bloom with nothing animating", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const id = await seedIdea(2);
  await signIn(page);
  await page.goto("/");
  const plant = plantOf(page, id);
  await expect(plant).toHaveAttribute("data-level", "sprout");
  await mentionAgain(id);
  await expect(plant).toHaveAttribute("data-level", "bloom", { timeout: 15_000 });
  await expect(plant).not.toHaveAttribute("data-bloom-from", /.*/);
  expect(await plant.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
  await expect(page.getByTestId("bloom-announcer")).toHaveText(`${TITLE} bloomed — mentioned 3 times.`);
  const chip = chipOf(page, id);
  await expect(chip).toBeVisible();
  expect(await chip.evaluate((el) => el.closest("li")!.getAnimations().length)).toBe(0);
});

test("a look is recorded on mount, and a live refresh is not a look", async ({ page }) => {
  const id = await seedIdea(1);
  const lastVisit = async () => {
    const [r] = await sql`select cursor from sync_cursors where name = 'garden_visit'`;
    return r ? (JSON.parse(String(r.cursor)) as { lastVisit: string }).lastVisit : null;
  };
  const before = await lastVisit();
  await signIn(page);
  await page.goto("/");
  await expect.poll(lastVisit, { timeout: 10_000 }).not.toBe(before); // the mount recorded a look
  // Dev Strict Mode runs the mount effect twice: two looks land ~100 ms apart. Let them settle before reading.
  await page.waitForTimeout(1_500);
  const atMount = await lastVisit();

  // A mention on a visible idea refreshes the page (newest timeline line) and must leave the record alone.
  const refreshed = page.waitForRequest((r) => r.url().includes("_rsc") || r.headers()["rsc"] === "1", { timeout: 20_000 });
  await mentionAgain(id);
  await refreshed;
  await expect(page.locator(".idea-card").filter({ has: page.locator(`[data-cluster-id="${id}"]`) }).locator(".idea-line"))
    .toContainText("said it again", { timeout: 10_000 });
  await page.waitForTimeout(1_000);
  expect(await lastVisit()).toBe(atMount);
});

test("search narrows the page by title and first name, and the tabs mark where you are", async ({ page }) => {
  const id = await seedIdea(2);
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
  await expect(page.locator("#garden-q-status")).toHaveText("Nothing here matches “zzzz no such thing”. Press Enter to search everything.");
  await search.fill("");
  await expect(plantItem).toBeVisible();

  // Enter hands the words to memory-cue search, which also reads mention excerpts (Bee neural search can take ~3 s).
  await search.fill("record shop");
  await search.press("Enter");
  await expect(page).toHaveURL(/\/search\?q=record\+shop$/);
  await expect(page.locator(`#search .idea-bed [data-cluster-id="${id}"]`)).toBeVisible({ timeout: 15_000 });
  await page.goto("/");

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
