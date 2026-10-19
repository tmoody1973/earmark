import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { neon } from "@neondatabase/serverless";
import { expect, test } from "@playwright/test";

// "Fix this tip", piece 3 (decision 049): fixes said out loud wait on Home for Apply / Ignore. Phone width (project
// "phone" = iPhone 13, 390 px), synthetic tips and proposals on the Neon TEST branch only (playwright.config.ts), removed
// afterwards. No provider or model calls: Apply only queues the lookup. Screenshots go to test-results/ (git-ignored).
const OWNER_EMAIL = process.env.E2E_OWNER_EMAIL;
if (!OWNER_EMAIL) throw new Error("E2E_OWNER_EMAIL must be set in .env.local");

test("phone: Home shows a spoken fix; Apply changes the tip, Ignore leaves it", async ({ page }, info) => {
  test.skip(info.project.name !== "phone", "phone project only");
  const sql = neon(process.env.TEST_DATABASE_URL!);
  const clean = () => sql`delete from recommendations where raw_text = 'sample-spoken-fix'`; // proposals cascade
  await clean();
  const tip = async (name: string, creator: string | null) => {
    const [r] = await sql`insert into recommendations (type, raw_text, canonical_name, creator, excerpt, said_at, source, status, confidence)
      values ('album', 'sample-spoken-fix', ${name}, ${creator}, 'a synthetic sample excerpt', now() - interval '1 day', 'ambient', 'new', 0.95)
      returning id`;
    return Number(r.id);
  };
  try {
    const applyTo = await tip("Sample Moth's new albums", "Sample Moth");
    const ignoreTo = await tip("Sample Harbour", null);
    await sql`insert into tip_fix_proposals (rec_id, name, creator) values (${applyTo}, 'Sample Lanquidity', 'Sample Ra')`;
    await sql`insert into tip_fix_proposals (rec_id, name, type) values (${ignoreTo}, 'Sample Harbor', 'book')`;

    await setupClerkTestingToken({ page });
    await page.goto("/sign-in");
    await clerk.signIn({ page, emailAddress: OWNER_EMAIL! });
    await page.goto("/");
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });

    const row = page.locator("#fixes");
    await expect(row.getByRole("heading", { name: "Fix these tips?" })).toBeVisible();
    const applyCard = row.locator(`[data-rec-id="${applyTo}"]`);
    await expect(applyCard.locator("h3")).toHaveText("Fix Sample Moth's new albums →to Sample Lanquidity, Sample Ra?");
    await expect(row.locator(`[data-rec-id="${ignoreTo}"] h3`)).toHaveText("Fix Sample Harbour →to Sample Harbor (Book)?");
    const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(scroll, "no horizontal scroll").toBeLessThanOrEqual(client);
    const small = await row.evaluate((el) => [...el.querySelectorAll<HTMLElement>("button")].filter((b) => b.getBoundingClientRect().height < 44).length);
    expect(small, "tap targets >= 44px tall").toBe(0);
    await row.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "test-results/spoken-fix-phone-home.png" });

    await applyCard.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Fixed:" })).toHaveText("Fixed: Sample Lanquidity, Sample Ra. Earmark is looking it up again.");
    await expect(applyCard).toHaveCount(0);
    const [a] = await sql`select canonical_name, creator, enrichment_status from recommendations where id = ${applyTo}`;
    expect(a).toEqual({ canonical_name: "Sample Lanquidity", creator: "Sample Ra", enrichment_status: "pending" });

    await row.locator(`[data-rec-id="${ignoreTo}"]`).getByRole("button", { name: "Ignore" }).click();
    await expect(page.locator("#fixes")).toHaveCount(0); // the last one gone: the row hides
    const [b] = await sql`select canonical_name, type from recommendations where id = ${ignoreTo}`;
    expect(b).toEqual({ canonical_name: "Sample Harbour", type: "album" });
    const [p] = await sql`select status from tip_fix_proposals where rec_id = ${ignoreTo}`;
    expect(p).toEqual({ status: "ignored" });
  } finally {
    await clean();
  }
});
