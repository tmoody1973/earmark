import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
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

for (const path of ["/gardeners", "/search", "/alexa"]) {
  test(`phone layout ${path}`, async ({ page }, info) => {
    test.skip(info.project.name !== "phone", "phone project only");
    await signIn(page);
    await page.goto(path);
    await page.addStyleTag({ content: HIDE_DEV_BADGE });
    await expect(page.locator("h1")).toBeVisible();
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
    await page.screenshot({ path: `test-results/m5-phone${path.replace("/", "-")}.png`, fullPage: true });
  });
}

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
