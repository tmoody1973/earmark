import { randomBytes } from "node:crypto";
import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { neon } from "@neondatabase/serverless";
import { expect, test, type Page } from "@playwright/test";

// M5-T15: lane C pages at phone width (project "phone" = iPhone 13, 390 px) and the Alexa+ simulator in a real browser.
// Screenshots go to test-results/ only (git-ignored): they can show real data.
const OWNER_EMAIL = process.env.E2E_OWNER_EMAIL;
if (!OWNER_EMAIL) throw new Error("E2E_OWNER_EMAIL must be set in .env.local");
const HIDE_DEV_BADGE = "nextjs-portal { display: none !important; }";

async function signIn(page: Page) {
  await setupClerkTestingToken({ page });
  await page.goto("/sign-in");
  await clerk.signIn({ page, emailAddress: OWNER_EMAIL! });
}

// The one phone check, shared by the lane C pages and the seeded receipt/publish pages below.
async function phoneCheck(page: Page, path: string) {
  await page.goto(path);
  await page.addStyleTag({ content: HIDE_DEV_BADGE });
  await expect(page.locator("h1, main.receipt-card")).toBeVisible(); // /r/<token> is a card with no h1 by design
  const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(scroll, "no horizontal scroll").toBeLessThanOrEqual(client);
  const small = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("main a, main button, main input, main select, main textarea, main summary")]
      // a checkbox or radio is tapped through its label, so the label is the target that must be 44px
      .map((el) => ({ el, r: (el.matches("input[type=checkbox], input[type=radio]") ? el.closest("label") ?? el : el).getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && r.height > 0 && r.height < 44)
      .map(({ el, r }) => `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}.${el.className} h=${Math.round(r.height)}`),
  );
  expect(small, "tap targets >= 44px tall").toEqual([]);
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("main *")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && (r.right > innerWidth + 1 || r.left < -1);
    }).map((el) => `${el.tagName.toLowerCase()}.${el.className}`),
  );
  expect(clipped, "nothing outside the viewport").toEqual([]);
}

for (const path of ["/gardeners", "/search", "/alexa"]) {
  test(`phone layout ${path}`, async ({ page }, info) => {
    test.skip(info.project.name !== "phone", "phone project only");
    await signIn(page);
    await phoneCheck(page, path);
    await page.screenshot({ path: `test-results/m5-phone${path.replace("/", "-")}.png`, fullPage: true });
  });
}

// The pages that need rows: a loved tip with an approved thank-you, and a published Space holding it. Synthetic rows on
// the Neon TEST branch only (playwright.config.ts), removed afterwards. No model calls.
test("phone layout receipt, public card, publish page and public Space", async ({ page }, info) => {
  test.skip(info.project.name !== "phone", "phone project only");
  test.skip(process.env.E2E_REAL === "1", "writes: test branch only");
  const sql = neon(process.env.TEST_DATABASE_URL!);
  const receiptToken = randomBytes(32).toString("base64url"); // 43 chars
  const spaceToken = randomBytes(32).toString("base64url");
  const clean = async () => {
    await sql`delete from spaces where rule_sentence like 'Sample phone:%'`;
    await sql`delete from recommendations where raw_text = 'sample-phone'`; // rec_receipts and space_items cascade
    await sql`delete from recommenders where first_name_key = 'samplephonefriend'`;
  };
  await clean();
  try {
    const [who] = await sql`insert into recommenders (first_name) values ('SamplePhoneFriend') returning id`;
    const [rec] = await sql`insert into recommendations (type, raw_text, canonical_name, creator, context_summary, excerpt,
        said_at, source, status, rating, recommender_id, confidence)
      values ('album', 'sample-phone', 'Sample Phone Recordings, 1962', 'The Sample Quartet', 'A sample reason it came up.',
        'sample excerpt', now() - interval '3 days', 'ambient', 'tried', 'loved', ${who.id}, 0.95)
      returning id`;
    await sql`insert into rec_receipts (recommendation_id, message, share_token, approved_at, sent_via)
      values (${rec.id}, 'Thank you for the Sample Phone Recordings tip. I played it three times this week and loved every minute.',
        ${receiptToken}, now(), 'link')`;
    const [space] = await sql`insert into spaces (name, rule_sentence, published_token, published_at)
      values ('Sample phone: records worth a second listen', 'Sample phone: records worth a second listen', ${spaceToken}, now())
      returning id`;
    await sql`insert into space_items (space_id, item_type, item_id, confidence, status) values (${space.id}, 'rec', ${rec.id}, 0.95, 'accepted')`;

    await page.goto("/"); // public pages need no sign-in
    await phoneCheck(page, `/r/${receiptToken}`);
    await page.screenshot({ path: "test-results/m5-phone-r-token.png", fullPage: true });
    await phoneCheck(page, `/s/${spaceToken}`);
    await page.screenshot({ path: "test-results/m5-phone-s-token.png", fullPage: true });

    await signIn(page);
    await phoneCheck(page, `/receipts/${rec.id}`);
    await page.screenshot({ path: "test-results/m5-phone-receipts-recId.png", fullPage: true });
    await phoneCheck(page, `/spaces/${space.id}/publish`);
    await page.screenshot({ path: "test-results/m5-phone-spaces-id-publish.png", fullPage: true });
  } finally {
    await clean();
  }
});

// The model and MCP path is unit-tested (tests/lib/alexa/sim.test.ts); here the reply is fixed so the run is deterministic.
const SIM_REPLY = { answer: "You saved Ramen Lab this month.", toolsUsed: ["search_earmarks"] };

test("alexa simulator answers a typed question", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "desktop project only");
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  let asked: unknown;
  await page.route("**/api/alexa-sim", async (route) => {
    asked = route.request().postDataJSON();
    await new Promise((r) => setTimeout(r, 300)); // long enough to see the thinking ring
    await route.fulfill({ json: SIM_REPLY });
  });
  await signIn(page);
  await page.goto("/alexa");
  const ring = page.locator(".ring");
  await expect(ring).toHaveClass(/ring-idle/);
  await page.getByLabel(/type your question/i).fill("What did I save this month?");
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(ring).toHaveClass(/ring-thinking/);
  await expect(page.locator(".turns .reply")).toContainText(SIM_REPLY.answer);
  expect(asked).toMatchObject({ question: "What did I save this month?", history: [] });
  await expect(ring).toHaveClass(/ring-(speaking|idle)/);
  await expect(page.locator(".turns .used")).toHaveText("used: search_earmarks");
  expect(errors, "no console errors").toEqual([]);
});

// M5-T14: a revoked or unknown published-Space link is a polite 404, never indexed. Public route: no sign-in.
test("unknown /s/ link is a polite 404 with noindex", async ({ page }) => {
  const res = await page.goto(`/s/${"x".repeat(43)}`);
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "This page is no longer shared" })).toBeVisible();
  // Next adds its own noindex to a 404 beside ours: every robots tag must say noindex.
  const robots = await page.locator('meta[name="robots"]').evaluateAll((els) => els.map((e) => e.getAttribute("content")));
  expect(robots.length).toBeGreaterThan(0);
  for (const content of robots) expect(content).toMatch(/noindex/);
});
