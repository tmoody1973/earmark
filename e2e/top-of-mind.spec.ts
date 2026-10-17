import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { neon } from "@neondatabase/serverless";
import { expect, test, type Page } from "@playwright/test";

// Top of Mind pins (M4-T9, FR-35). Writes: TEST branch only (playwright.config.ts points the server there). Synthetic
// rows titled "Sample pin: …". The dev server has no BEE_TODO_WRITES, so a pin here queues no Bee fact.
const OWNER_EMAIL = process.env.E2E_OWNER_EMAIL!;
const HIDE_DEV_BADGE = "nextjs-portal { display: none !important; }";
const DIR = "docs/design/screens"; // git-ignored

async function signInAs(page: Page, emailAddress: string) {
  await setupClerkTestingToken({ page });
  await page.goto("/sign-in");
  await clerk.signIn({ page, emailAddress });
}

test("Top of mind: pin an idea, see it first and flagged on a new mention, the flag clears on open, the cap holds", async ({ page }, info) => {
  test.skip(process.env.E2E_REAL === "1", "writes: test branch only");
  const sql = neon(process.env.TEST_DATABASE_URL!);
  const width = info.project.name === "phone" ? 390 : 1440;

  await sql`delete from idea_clusters where title like 'Sample pin:%'`;
  await sql`update idea_clusters set pinned = false where pinned`; // test branch only: other specs' pins would eat the cap
  const idea = async (title: string, stage = "sprouting") => {
    const [c] = await sql`insert into idea_clusters (title, stage, mention_count, first_mentioned_at, last_mentioned_at, timeline)
      values (${`Sample pin: ${title}`}, ${stage}, 2, now() - interval '9 days', now() - interval '20 days',
        ${JSON.stringify([{ date: new Date(Date.now() - 9 * 864e5).toISOString(), line: "Oct 8: first heard" }])}::jsonb)
      returning id`;
    await sql`insert into idea_mentions (cluster_id, bee_conversation_id, excerpt, spoken_at, confidence, review_status, source)
      values (${c.id}, ${8_200_000 + Math.floor(Math.random() * 90_000)}, 'a synthetic sample excerpt', now() - interval '9 days', 0.95, 'accepted', 'ambient')`;
    return Number(c.id);
  };
  const id = await idea("A crate-digging hour of station records");

  await signInAs(page, OWNER_EMAIL);
  await page.goto(`/ideas/${id}`);
  const pin = page.getByRole("button", { name: "Top of mind" });
  await expect(pin).toHaveAttribute("aria-pressed", "false");
  expect((await pin.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await pin.click();
  await expect(pin).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("status").filter({ hasText: "On Top of Mind" })).toBeVisible();
  await expect.poll(async () => (await sql`select pinned from idea_clusters where id = ${id}`)[0].pinned).toBe(true);
  expect((await sql`select count(*)::int as n from fact_proposals where evidence_ids @> ${JSON.stringify([id])}::jsonb`)[0].n).toBe(0);
  await page.addStyleTag({ content: HIDE_DEV_BADGE });
  await page.locator(".idea-head").screenshot({ path: `${DIR}/m4-pin-idea-${width}.png` });

  // A mention joins the pinned idea (save-item.ts sets flagged_at; set directly here, the SQL is unit/int tested)
  await sql`update idea_clusters set flagged_at = now() where id = ${id}`;
  await page.goto("/garden");
  const plant = page.locator(".idea-card").filter({ hasText: "A crate-digging hour" });
  await expect(page.locator(".idea-card").first()).toContainText("A crate-digging hour"); // pinned first
  await expect(plant.locator(".idea-meta")).toContainText("Top of mind");
  await expect(plant.locator(".idea-flag")).toHaveText("New mention");
  await page.addStyleTag({ content: HIDE_DEV_BADGE });
  await page.screenshot({ path: `${DIR}/m4-pin-garden-${width}.png` });

  // Opening the idea clears the flag
  await plant.getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/ideas/${id}$`));
  await expect.poll(async () => {
    await page.goto("/garden");
    return page.locator(".idea-card").filter({ hasText: "A crate-digging hour" }).locator(".idea-flag").count();
  }).toBe(0);

  // The cap: with 5 pinned, a sixth is refused in words and stays unpinned
  for (let n = 0; n < 4; n++) await sql`update idea_clusters set pinned = true where id = ${await idea(`Filler ${n}`)}`;
  const sixth = await idea("One idea too many");
  await page.goto(`/ideas/${sixth}`);
  await page.getByRole("button", { name: "Top of mind" }).click();
  await expect(page.getByText("Top of Mind holds 5 ideas. Unpin one to make room.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Top of mind" })).toHaveAttribute("aria-pressed", "false");
  expect((await sql`select pinned from idea_clusters where id = ${sixth}`)[0].pinned).toBe(false);
  await page.addStyleTag({ content: HIDE_DEV_BADGE });
  await page.locator(".idea-head").screenshot({ path: `${DIR}/m4-pin-cap-${width}.png` });

  // Unpin
  await page.goto(`/ideas/${id}`);
  await page.getByRole("button", { name: "Top of mind" }).click();
  await expect(page.getByRole("button", { name: "Top of mind" })).toHaveAttribute("aria-pressed", "false");
  await expect.poll(async () => (await sql`select pinned from idea_clusters where id = ${id}`)[0].pinned).toBe(false);
  await sql`delete from idea_clusters where title like 'Sample pin:%'`;
});
