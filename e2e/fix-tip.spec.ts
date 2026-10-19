import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { neon } from "@neondatabase/serverless";
import { expect, test } from "@playwright/test";

// "Fix this tip" (decision 049) at phone width (project "phone" = iPhone 13, 390 px), on a synthetic tip on the Neon TEST
// branch only (playwright.config.ts), removed afterwards. No provider or model calls: the lookup is only queued.
// Screenshots go to test-results/ only (git-ignored).
const OWNER_EMAIL = process.env.E2E_OWNER_EMAIL;
if (!OWNER_EMAIL) throw new Error("E2E_OWNER_EMAIL must be set in .env.local");

test("phone: fix a tip's words, then its note", async ({ page }, info) => {
  test.skip(info.project.name !== "phone", "phone project only");
  const sql = neon(process.env.TEST_DATABASE_URL!);
  const clean = () => sql`delete from recommendations where raw_text = 'sample-fix-tip'`;
  await clean();
  try {
    const [rec] = await sql`insert into recommendations (type, raw_text, canonical_name, creator, context_summary, excerpt,
        said_at, source, status, confidence, enrichment_status, enriched_at, image_url, links)
      values ('album', 'sample-fix-tip', 'Sample Rose''s new albums', 'Sample Rose', 'On Sun Raw Records.',
        'her new albums on sun raw records', now() - interval '2 days', 'ambient', 'new', 0.95, 'matched', now(),
        'https://coverartarchive.org/release-group/sample/front-250', '{"musicbrainz":"https://musicbrainz.org/x"}'::jsonb)
      returning id`;

    await setupClerkTestingToken({ page });
    await page.goto("/sign-in");
    await clerk.signIn({ page, emailAddress: OWNER_EMAIL! });
    await page.goto(`/tips/${rec.id}`);
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });

    const fix = page.locator(".tip-fix");
    await fix.getByText("Fix this tip").click();
    await expect(page.getByLabel("Name")).toHaveValue("Sample Rose's new albums");
    await expect(page.getByLabel("By")).toHaveValue("Sample Rose");
    await expect(page.getByLabel("Type")).toHaveValue("album");
    await expect(page.getByLabel("Note")).toHaveValue("On Sun Raw Records.");
    const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(scroll, "no horizontal scroll").toBeLessThanOrEqual(client);
    const small = await fix.evaluate((el) => [...el.querySelectorAll<HTMLElement>("summary, input, select, textarea, button")]
      .filter((c) => c.getBoundingClientRect().height < 44).map((c) => c.tagName));
    expect(small, "tap targets >= 44px tall").toEqual([]);
    await expect(page.locator(".tip-quote")).toContainText("her new albums on sun raw records"); // the quote is not a field
    await page.screenshot({ path: "test-results/fix-tip-phone-open.png", fullPage: true });

    await page.getByLabel("Name").fill("Sun Ra");
    await fix.getByRole("button", { name: "Save" }).click();
    await expect(fix.getByRole("status")).toHaveText("Saved. Looking it up again — check back in about 10 minutes.");
    const [a] = await sql`select canonical_name, enrichment_status, image_url, links from recommendations where id = ${rec.id}`;
    expect(a).toEqual({ canonical_name: "Sun Ra", enrichment_status: "pending", image_url: null, links: {} });
    await expect(page.locator("h1")).toHaveText("Sun Ra"); // the page re-rendered with the fix

    await page.getByLabel("Note").fill("On Sun Ra's own label, Saturn.");
    await fix.getByRole("button", { name: "Save" }).click();
    await expect(fix.getByRole("status")).toHaveText("Saved.");
    const [b] = await sql`select context_summary, why_source from recommendations where id = ${rec.id}`;
    expect(b).toEqual({ context_summary: "On Sun Ra's own label, Saturn.", why_source: "owner" });
    await page.screenshot({ path: "test-results/fix-tip-phone-saved.png", fullPage: true });
  } finally {
    await clean();
  }
});
