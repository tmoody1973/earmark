import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { neon } from "@neondatabase/serverless";
import { expect, test } from "@playwright/test";

// Heard nearby (decision 052) at phone width (project "phone" = iPhone 13, 390 px), on synthetic overheard tips on the
// Neon TEST branch only (playwright.config.ts), removed afterwards. No provider or model calls: Keep only queues a lookup.
// Screenshots go to test-results/ only (git-ignored).
const OWNER_EMAIL = process.env.E2E_OWNER_EMAIL;
if (!OWNER_EMAIL) throw new Error("E2E_OWNER_EMAIL must be set in .env.local");

test("phone: Home's quiet link opens Heard nearby; Keep puts a tip on the shelf, Clear dismisses one", async ({ page }, info) => {
  test.skip(info.project.name !== "phone", "phone project only");
  const sql = neon(process.env.TEST_DATABASE_URL!);
  const clean = () => sql`delete from recommendations where raw_text = 'sample-heard-nearby'`;
  await clean();
  try {
    const [keep] = await sql`insert into recommendations (type, raw_text, canonical_name, excerpt, said_at, source, status, confidence)
      values ('podcast', 'sample-heard-nearby', 'Sample Hour', 'the new episode of sample hour is out now', now() - interval '1 hour',
        'ambient', 'overheard', 0.95) returning id`;
    const [drop] = await sql`insert into recommendations (type, raw_text, canonical_name, excerpt, said_at, source, status, confidence)
      values ('video', 'sample-heard-nearby', 'Sample Ad', 'you should try sample ad today', now() - interval '2 hours',
        'ambient', 'overheard', 0.92) returning id`;

    await setupClerkTestingToken({ page });
    await page.goto("/sign-in");
    await clerk.signIn({ page, emailAddress: OWNER_EMAIL! });
    await page.goto("/");
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await page.getByRole("link", { name: "Heard nearby", exact: true }).click(); // the link has no number

    await expect(page).toHaveURL(/\/heard$/);
    await expect(page).toHaveTitle("Heard nearby · Earmark");
    await expect(page.locator("h1")).toHaveText("Heard nearby");
    await expect(page.getByText(/no one recommending them to you/)).toBeVisible();
    const row = (id: number) => page.locator(`[data-testid="heard-row"][data-rec-id="${id}"]`);
    await expect(row(keep.id)).toContainText("Sample Hour");
    await expect(row(keep.id)).toContainText(/Heard \w{3}, \w{3} \d+, \d+:\d\d [AP]M/);
    await expect(row(keep.id).locator(".heard-quote")).toHaveText("“the new episode of sample hour is out now”");
    const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(scroll, "no horizontal scroll").toBeLessThanOrEqual(client);
    const small = await row(keep.id).evaluate((el) => [...el.querySelectorAll<HTMLElement>("button")]
      .filter((b) => b.getBoundingClientRect().height < 44).map((b) => b.textContent));
    expect(small, "tap targets >= 44px tall").toEqual([]);
    await page.screenshot({ path: "test-results/heard-nearby-phone.png", fullPage: true });

    await row(keep.id).getByRole("button", { name: "Keep" }).click();
    await expect(row(keep.id)).toHaveCount(0);
    await expect(page.locator("#heard").getByRole("status")).toHaveText("Kept: Sample Hour. It’s on your shelf.");
    await expect.poll(async () => (await sql`select status from recommendations where id = ${keep.id}`)[0]!.status).toBe("new");

    await row(drop.id).getByRole("button", { name: "Clear" }).click();
    await expect(row(drop.id)).toHaveCount(0);
    await expect(page.locator("#heard").getByRole("status")).toHaveText("Cleared: Sample Ad");
    await expect.poll(async () => (await sql`select status from recommendations where id = ${drop.id}`)[0]!.status).toBe("dismissed");
    await page.screenshot({ path: "test-results/heard-nearby-phone-done.png", fullPage: true });

    await page.goto("/shelf");
    await expect(page.getByTestId("rec-card").filter({ hasText: "Sample Hour" })).toBeVisible();
  } finally {
    await clean();
  }
});
