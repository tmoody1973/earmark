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
  const homePlants = page.locator("#garden section[aria-labelledby=ideas-h]").getByTestId("plant"); // the Ideas zone, not Serendipity
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
  // two polite regions on this page now (the Maybe? row's and the shelf cards'), so find it by its words
  await expect(page.getByRole("status").filter({ hasText: /^Kept: The Remains of the Day$/ })).toHaveCount(1);
  expect(await page.evaluate(() => document.activeElement?.id ?? "")).toMatch(/^maybe-\d+-keep$/);
  await expect(shelfCard("The Remains of the Day")).toBeVisible();

  // Not a tip: gone, and stays gone
  await card("Weekly standup board").getByRole("button", { name: "Not a tip" }).click();
  await expect(card("Weekly standup board")).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: /^Removed: Weekly standup board$/ })).toHaveCount(1);
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

// Home opens with an empty pile; a maybe saved while it is open must appear on the next live refresh
// (router.refresh keeps client state, so the row cannot decide once at mount). Every other maybe on the TEST branch
// is parked (composted) for the test and restored after.
test("Maybe?: a maybe that arrives while Home is open shows up on the live refresh", async ({ page }) => {
  test.skip(process.env.E2E_REAL === "1", "writes: test branch only");
  const sql = neon(process.env.TEST_DATABASE_URL!);
  await sql`delete from recommendations where raw_text = 'sample-maybe-live'`;
  const parked = (await sql`update recommendations set status = 'composted' where status = 'needs_review' returning id`)
    .map((r) => Number(r.id));
  try {
    await signInAs(page, OWNER_EMAIL);
    await page.goto("/");
    const plant = page.locator("#garden").getByTestId("plant").first();
    await expect(plant).toBeVisible();
    await expect(page.locator("#maybe")).toHaveCount(0); // empty pile: no row
    await page.evaluate(() => { (window as unknown as { stillHere?: boolean }).stillHere = true; });

    await sql`insert into recommendations (type, raw_text, canonical_name, excerpt, said_at, source, status, confidence)
      values ('podcast', 'sample-maybe-live', 'Heavyweight', 'sample excerpt', now(), 'ambient', 'needs_review', 0.7)`;
    // a mention on a plant already on the page: the poller asks for a router.refresh (agent/lib/garden/live.ts)
    await sql`insert into garden_events (kind, cluster_id) values ('mention', ${Number(await plant.getAttribute("data-cluster-id"))})`;

    await expect(page.getByTestId("maybe-card").filter({ hasText: "Heavyweight" })).toBeVisible({ timeout: 20_000 });
    expect(await page.evaluate(() => (window as unknown as { stillHere?: boolean }).stillHere)).toBe(true); // a refresh, not a reload
  } finally {
    await sql`delete from recommendations where raw_text = 'sample-maybe-live'`;
    await sql`update recommendations set status = 'needs_review' where id = any(${parked})`;
  }
});

// FR-22 (M3-T10): a card's "…" offers Try this, Tried it, a rating and Dismiss. Writes, so TEST branch only: it seeds
// its own invented tips (raw_text = 'sample-tip-actions', re-runnable) from an invented recommender, Marisol.
test("a tip's …: Try this, Tried it, Loved it and Dismiss show at once, save, and match People's counts", async ({ page }, info) => {
  test.skip(process.env.E2E_REAL === "1", "writes: test branch only");
  const sql = neon(process.env.TEST_DATABASE_URL!);
  const width = info.project.name === "phone" ? 390 : 1440;
  const dir = "test-results/screens";
  const noOverflow = async () =>
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  const said = (text: string) => page.getByRole("status").filter({ hasText: new RegExp(`^${text}$`) });

  await sql`delete from recommendations where raw_text = 'sample-tip-actions'`;
  const marisol = (await sql`insert into recommenders (first_name) values ('Marisol')
    on conflict (first_name_key) do update set first_name = excluded.first_name returning id`)[0].id as number;
  const tips: Array<[string, string, string | null, string]> = [
    ["album", "Spirit of Eden", "Talk Talk", "Headphones, lights off, start to finish."],
    ["book", "The Dispossessed", "Ursula K. Le Guin", "Two worlds, one honest argument."],
    ["other", "The Sunday crossword", null, "Do it in pen."],
  ];
  let minute = 0;
  for (const [type, name, creator, why] of tips) {
    await sql`insert into recommendations
      (type, raw_text, canonical_name, creator, recommender_id, context_summary, excerpt, said_at, source, status, confidence)
      values (${type}, 'sample-tip-actions', ${name}, ${creator}, ${marisol}, ${why}, 'sample excerpt',
        now() - make_interval(mins => ${minute++}), 'ambient', 'new', 0.95)`;
  }
  const db = async (name: string) =>
    (await sql`select status, rating from recommendations where raw_text = 'sample-tip-actions' and canonical_name = ${name}`)[0];

  await signInAs(page, OWNER_EMAIL);
  await page.goto("/shelf");
  const card = (name: string) => page.getByTestId("rec-card").filter({ has: page.getByRole("heading", { name, exact: true }) });
  const more = (name: string) => card(name).getByRole("button", { name: `Options for ${name}`, exact: true });
  const choice = (name: string, label: string) => card(name).getByRole("button", { name: label, exact: true });

  // closed: one quiet 44 px target per card, nothing else
  const eden = more("Spirit of Eden");
  const box = (await eden.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  await expect(choice("Spirit of Eden", "Try this")).toBeHidden();

  // open: a new tip offers Try this, Tried it, Dismiss; focus goes to the first; Escape closes and returns focus
  await eden.click();
  await expect(eden).toHaveAttribute("aria-expanded", "true");
  await expect(card("Spirit of Eden").getByRole("list").getByRole("button")).toHaveText(["Try this", "Tried it", "Dismiss"]);
  for (const b of await card("Spirit of Eden").getByRole("list").getByRole("button").all()) {
    expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await expect(choice("Spirit of Eden", "Try this")).toBeFocused();
  await page.addStyleTag({ content: HIDE_DEV_BADGE });
  await loadImages(page);
  await card("Spirit of Eden").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${dir}/m3-tip-menu-${width}.png` });
  await page.keyboard.press("Escape");
  await expect(eden).toHaveAttribute("aria-expanded", "false");
  await expect(eden).toBeFocused();

  // Try this → "To try" at once, announced, saved as queued (the Bee todo is the reconciler's, switch off here)
  await eden.click();
  await choice("Spirit of Eden", "Try this").click();
  await expect(card("Spirit of Eden").locator(".rec-tag")).toHaveText("To try");
  await expect(said("Marked to try: Spirit of Eden")).toHaveCount(1);
  await expect(eden).toBeFocused();
  await expect.poll(() => db("Spirit of Eden")).toMatchObject({ status: "queued" });

  // Tried it → Tried; then the menu offers the ratings; Loved it → the heart tag, and the choice shows as pressed
  await eden.click();
  await expect(card("Spirit of Eden").getByRole("list").getByRole("button")).toHaveText(["Tried it", "Dismiss"]);
  await choice("Spirit of Eden", "Tried it").click();
  await expect(card("Spirit of Eden").locator(".rec-tag")).toHaveText("Tried");
  await expect.poll(() => db("Spirit of Eden")).toMatchObject({ status: "tried" });
  await eden.click();
  await expect(card("Spirit of Eden").getByRole("list").getByRole("button")).toHaveText(["Loved it", "It was fine", "Not for me"]); // no Dismiss once tried (decision 024)
  await choice("Spirit of Eden", "Loved it").click();
  await expect(card("Spirit of Eden").locator(".rec-tag")).toHaveText("Loved it");
  await expect(said("Loved it: Spirit of Eden")).toHaveCount(1);
  await expect.poll(() => db("Spirit of Eden")).toMatchObject({ status: "tried", rating: "loved" });
  await eden.click();
  await expect(choice("Spirit of Eden", "Loved it")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");

  // a failed save puts the card back as it was, and says so
  const shelfUrl = (url: URL) => url.pathname === "/shelf"; // one reference: unroute matches it by identity
  await page.route(shelfUrl, (route) => (route.request().method() === "POST" ? route.abort() : route.continue()));
  await more("The Dispossessed").click();
  await choice("The Dispossessed", "Tried it").click();
  await expect(said("Couldn't save that. The Dispossessed is back as it was; try again.")).toHaveCount(1);
  await expect(card("The Dispossessed").locator(".rec-tag")).toHaveCount(0);
  await page.unroute(shelfUrl);
  expect(await db("The Dispossessed")).toMatchObject({ status: "new", rating: null });

  // marked tried elsewhere (Bee, Notion) while this page is open: Try this is refused by its from-guard and says so
  await sql`update recommendations set status = 'tried' where raw_text = 'sample-tip-actions' and canonical_name = 'The Dispossessed'`;
  await more("The Dispossessed").click();
  await choice("The Dispossessed", "Try this").click();
  await expect(said("Nothing changed — it was updated elsewhere")).toHaveCount(1);
  await expect(card("The Dispossessed").locator(".rec-tag")).toHaveText("Tried"); // the refreshed card shows the truth
  expect(await db("The Dispossessed")).toMatchObject({ status: "tried" });

  // Dismiss → gone at once, announced, focus moves to another card's "…", and it stays gone
  await more("The Sunday crossword").click();
  await choice("The Sunday crossword", "Dismiss").click();
  await expect(card("The Sunday crossword")).toHaveCount(0);
  await expect(said("Dismissed: The Sunday crossword")).toHaveCount(1);
  expect(await page.evaluate(() => document.activeElement?.className ?? "")).toBe("tip-more");
  await expect.poll(() => db("The Sunday crossword")).toMatchObject({ status: "dismissed" });
  await page.reload();
  await expect(card("The Sunday crossword")).toHaveCount(0);
  await expect(card("Spirit of Eden").locator(".rec-tag")).toHaveText("Loved it");

  // People counts what the cards say (decision 024): 2 tips (the dismissed one is gone), both tried, loved 1
  await page.goto(`/people/${marisol}`);
  await expect(page.locator(".person-head p")).toHaveText("2 tips · 2 tried · loved 1");
  await expect(more("The Dispossessed")).toBeVisible(); // the person page offers the same menu

  // 320 px: the open list stays on screen and nothing scrolls sideways
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/shelf");
  for (const name of ["Spirit of Eden", "The Dispossessed"]) {
    await more(name).click();
    const list = (await card(name).getByRole("list").boundingBox())!;
    expect(list.x).toBeGreaterThanOrEqual(0);
    expect(list.x + list.width).toBeLessThanOrEqual(320);
    await page.keyboard.press("Escape");
  }
  await noOverflow();
});

// M3-T4b: the Wikipedia note sits under the why as its own quiet line; its source is its own tap target.
test("a tip's Wikipedia note shows under the why, with its source above the card link", async ({ page }, info) => {
  test.skip(process.env.E2E_REAL === "1", "writes: test branch only");
  const sql = neon(process.env.TEST_DATABASE_URL!);
  await sql`delete from recommendations where raw_text = 'sample-about'`;
  const about = "Sault are a British music group that make a mixture of R&B, urban contemporary gospel, house and disco.";
  const url = "https://en.wikipedia.org/wiki/Sault_(band)";
  await sql`insert into recommendations
    (type, raw_text, canonical_name, creator, context_summary, excerpt, said_at, source, status, confidence, links,
     enrichment_status, about, about_url, about_at)
    values ('album', 'sample-about', 'Untitled (Rise)', 'SAULT', 'Put it on loud on a Sunday morning.', 'sample excerpt',
      now(), 'ambient', 'new', 0.95, ${JSON.stringify({ apple_music: "https://music.apple.com/us/album/1" })}::jsonb,
      'matched', ${about}, ${url}, now())`;
  try {
    await signInAs(page, OWNER_EMAIL);
    await page.goto("/shelf");
    const card = page.getByTestId("rec-card").filter({ has: page.getByRole("heading", { name: "Untitled (Rise)", exact: true }) });
    await expect(card.locator(".rec-why")).toHaveText("“Put it on loud on a Sunday morning.”"); // the why stays the why
    const note = card.locator(".rec-about");
    await expect(note).toHaveText(`${about} Wikipedia`);
    const source = note.getByRole("link", { name: "Wikipedia" });
    await expect(source).toHaveAttribute("href", url);
    // the why first, the note right under it
    const [why, line] = [(await card.locator(".rec-why").boundingBox())!, (await note.boundingBox())!];
    expect(line.y).toBeGreaterThanOrEqual(why.y + why.height - 1);
    // the source link is its own target, above the card-wide title link
    await source.scrollIntoViewIfNeeded();
    const s = (await source.boundingBox())!;
    const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.className ?? "none", [s.x + s.width / 2, s.y + s.height / 2]);
    expect(hit).toBe("rec-about-src");
    await source.click({ trial: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await page.addStyleTag({ content: HIDE_DEV_BADGE });
    await card.scrollIntoViewIfNeeded();
    await card.screenshot({ path: `${SHOTS}/m3-about-${info.project.name}.png` });
  } finally {
    await sql`delete from recommendations where raw_text = 'sample-about'`;
  }
});
