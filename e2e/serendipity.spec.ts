import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { neon } from "@neondatabase/serverless";
import { expect, test, type Page } from "@playwright/test";

// Serendipity (M4-T8, FR-34). Writes: TEST branch only (playwright.config.ts points the server there). Synthetic rows
// only ("Sample serendipity: …"), dated ten years back so they are the most forgotten things on the branch.
// No model calls. The tip is "new", so composting it has no Bee todo to clear (that path is unit-tested).
const OWNER_EMAIL = process.env.E2E_OWNER_EMAIL!;
const HIDE_DEV_BADGE = "nextjs-portal { display: none !important; }";
const DIR = "docs/design/screens"; // git-ignored

async function signInAs(page: Page, emailAddress: string) {
  await setupClerkTestingToken({ page });
  await page.goto("/sign-in");
  await clerk.signIn({ page, emailAddress });
}

test("Serendipity: one forgotten thing at a time; an idea rests, a tip composts, undo", async ({ page }, info) => {
  test.skip(process.env.E2E_REAL === "1", "writes: test branch only");
  const sql = neon(process.env.TEST_DATABASE_URL!);
  const width = info.project.name === "phone" ? 390 : 1440;
  const noOverflow = async () =>
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  const clean = async () => {
    await sql`delete from idea_clusters where title like 'Sample serendipity:%'`;
    await sql`delete from recommendations where raw_text = 'sample-serendipity'`;
  };

  await clean();
  try {
    const [plant] = await sql`insert into idea_clusters (title, stage, mention_count, first_mentioned_at, last_mentioned_at, created_at, timeline)
      values ('Sample serendipity: a radio hour of songs strangers hum', 'sprouting', 2,
        now() - interval '12 years', now() - interval '12 years', now() - interval '12 years',
        ${JSON.stringify([{ date: "2014-10-02T18:00:00.000Z", line: "Oct 2: wondered who would call in" }])}::jsonb)
      returning id`;
    const [tip] = await sql`insert into recommendations (type, raw_text, canonical_name, creator, context_summary, excerpt,
        said_at, created_at, source, status, confidence)
      values ('book', 'sample-serendipity', 'Sample serendipity: The Field Recordings Reader', 'A. Sample',
        'A sample reason it came up.', 'sample excerpt', now() - interval '11 years', now() - interval '11 years', 'ambient', 'new', 0.95)
      returning id`;

    await signInAs(page, OWNER_EMAIL);
    await page.goto("/");
    await page.addStyleTag({ content: HIDE_DEV_BADGE });
    const section = page.getByTestId("serendipity");
    const item = page.getByTestId("serendipity-item");
    const status = page.getByRole("status").filter({ hasText: /./ });

    // The idea first: it has gone unheard longest
    await expect(section.getByRole("heading", { name: "Serendipity", exact: true })).toBeVisible();
    await expect(item.getByRole("link", { name: /a radio hour of songs strangers hum/ })).toBeVisible();
    await expect(item).toContainText(/Heard \d+ days ago/);
    for (const b of await section.getByRole("button").all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await noOverflow();
    await section.scrollIntoViewIfNeeded();
    await section.screenshot({ path: `${DIR}/m4-serendipity-idea-${width}.png` });

    // An idea is never composted from here: Not now rests it, still sprouting in the garden; Serendipity moves on to the tip
    await expect(section.getByRole("button", { name: "Let it compost" })).toHaveCount(0);
    await section.getByRole("button", { name: "Not now" }).click();
    await expect(status).toHaveText("Resting — it’ll come back around in a couple of months.");
    await expect(item.getByRole("heading", { name: /The Field Recordings Reader/ })).toBeVisible();
    const [rested] = await sql`select stage, resting_until > now() + interval '59 days' as long_rest from idea_clusters where id = ${plant.id}`;
    expect(rested).toEqual({ stage: "sprouting", long_rest: true });
    await noOverflow();
    await section.screenshot({ path: `${DIR}/m4-serendipity-tip-${width}.png` });

    // Let it compost: it leaves the shelf, and Undo is offered (and focused)
    await section.getByRole("button", { name: "Let it compost" }).click();
    await expect(status).toHaveText(/went back to the compost/);
    const undo = section.getByRole("button", { name: /^Undo/ });
    await expect(undo).toBeFocused();
    expect((await sql`select status from recommendations where id = ${tip.id}`)[0].status).toBe("composted");
    await section.screenshot({ path: `${DIR}/m4-serendipity-composted-${width}.png` });

    // Undo: the tip is back on the shelf, and does not come straight back to Serendipity (cooldown)
    await undo.click();
    await expect(status).toHaveText(/is back/);
    expect((await sql`select status from recommendations where id = ${tip.id}`)[0].status).toBe("new");
    await page.reload();
    await expect(page.getByTestId("serendipity-item").getByText(/Sample serendipity/)).toHaveCount(0);
  } finally {
    await clean();
  }
});
