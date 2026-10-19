import { Pool } from "@neondatabase/serverless";
import { expect, test, type Page } from "@playwright/test";
import { DEMO_BANNER, DEMO_READ_ONLY } from "../agent/lib/demo";
import { TIPS } from "../scripts/demo-data";
import { removeDemoSeed, seedDemo, type SeededIds } from "../scripts/seed-demo";

// The judge demo (decision 053) at phone width (project "phone" = iPhone 13, 390 px). Run with E2E_DEMO=1
// (playwright.config.ts turns EARMARK_DEMO on, still on the Neon TEST branch). The sample garden is seeded on TEST for
// this run and removed afterwards, by id. Nobody signs in. Nothing leaves the machine: every request to another host is
// aborted (cover art falls back to its drawn state), and so is the OSM tile proxy. Screenshots go to test-results/ only.

const recId = (ids: SeededIds, name: string) => ids.recs[TIPS.findIndex((t) => t.name === name)]!;

async function expectDemoPage(page: Page, path: string, heading: string | RegExp, shot: string) {
  await page.goto(path);
  await expect(page).toHaveURL(new RegExp(`${path.replace(/[?]/g, "\\?")}$`)); // no sign-in redirect
  await expect(page.locator(".demo-banner")).toContainText(DEMO_BANNER);
  await expect(page.locator("h1").first()).toHaveText(heading);
  const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(scroll, `${path}: no horizontal scroll`).toBeLessThanOrEqual(client);
  await page.screenshot({ path: `test-results/demo-${shot}-phone.png`, fullPage: true });
}

test("phone: a stranger browses the sample garden without signing in, and a Keep tap says it is a read-only demo", async ({ page }, info) => {
  test.skip(info.project.name !== "phone", "phone project only");
  test.setTimeout(180_000);
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const c = await pool.connect();
  let ids: SeededIds | undefined;
  try {
    await c.query("begin");
    try {
      ids = await seedDemo(c, new Date());
      await c.query("commit");
    } catch (err) {
      await c.query("rollback");
      ids = undefined;
      throw err;
    }
    const origin = new URL(info.project.use.baseURL ?? "http://localhost").origin;
    await page.route((url) => url.origin !== origin || url.pathname.startsWith("/api/tiles/"), (r) => r.abort());
    await page.addInitScript(() => {
      // the Next dev overlay can cover the tab bar; hide it like the other specs do
      document.addEventListener("DOMContentLoaded", () => {
        const s = document.createElement("style");
        s.textContent = "nextjs-portal { display: none !important; }";
        document.head.append(s);
      });
    });

    await expectDemoPage(page, "/", "Earmark", "home");
    await expectDemoPage(page, `/shelf?rec=${recId(ids, "Piranesi")}`, "Shelf", "shelf");
    await expect(page.locator(`#rec-${recId(ids, "Piranesi")}`)).toContainText("Piranesi");
    await expectDemoPage(page, `/tips/${recId(ids, "The Overstory")}`, "The Overstory", "tip");
    await expect(page.locator("main")).toContainText("First published 2018");
    await expect(page.locator("main")).toContainText("Margit");
    await expectDemoPage(page, `/people/${ids.recommenders[0]}`, "Rosalie", "person");
    await expectDemoPage(page, "/people", "People", "people");
    await expectDemoPage(page, "/search?q=lakefront", "Look back", "search"); // store words only: no Bee call in the demo
    await expect(page.locator(`#rec-${recId(ids, "Lakefront Brewery")}`)).toBeVisible();
    await expectDemoPage(page, "/heard", "Heard nearby", "heard");

    // A write: proxy.ts refuses it, the row comes back, and the banner says why.
    const hardFork = recId(ids, "Hard Fork");
    const row = page.locator(`[data-testid="heard-row"][data-rec-id="${hardFork}"]`);
    await expect(row).toContainText("Hard Fork");
    await row.getByRole("button", { name: "Keep" }).click();
    await expect(page.locator(".demo-banner").getByRole("status")).toHaveText(DEMO_READ_ONLY);
    await expect(row).toBeVisible(); // the optimistic removal is undone
    expect((await c.query(`select status from recommendations where id = $1`, [hardFork])).rows[0].status).toBe("overheard");
    await page.screenshot({ path: "test-results/demo-refused-phone.png", fullPage: true });
  } finally {
    if (ids) await removeDemoSeed(c, ids);
    c.release();
    await pool.end();
  }
});
