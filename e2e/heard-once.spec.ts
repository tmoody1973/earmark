import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { neon } from "@neondatabase/serverless";
import { expect, test } from "@playwright/test";

// Quiet ideas (decision 055) at phone width (project "phone" = iPhone 13, 390 px), on synthetic ideas on the Neon TEST
// branch only (playwright.config.ts), removed afterwards. No provider or model calls. Screenshots go to test-results/
// only (git-ignored).
const OWNER_EMAIL = process.env.E2E_OWNER_EMAIL;
if (!OWNER_EMAIL) throw new Error("E2E_OWNER_EMAIL must be set in .env.local");
const PREFIX = "Sample heard once:";

test("phone: ideas heard once wait off the garden; Keep shows one, Dismiss and Undo, Dismiss on an idea's page", async ({ page }, info) => {
  test.skip(info.project.name !== "phone", "phone project only");
  const sql = neon(process.env.TEST_DATABASE_URL!);
  const clean = () => sql`delete from idea_clusters where title like ${`${PREFIX}%`}`;
  // An idea with one mention per entry in `sources` ('ambient' alone = overheard once).
  const idea = async (title: string, minutesAgo: number, sources: string[]) => {
    const [c] = await sql`insert into idea_clusters (title, stage, mention_count, first_mentioned_at, last_mentioned_at)
      values (${`${PREFIX} ${title}`}, ${sources.length >= 2 ? "sprouting" : "compost"}, ${sources.length},
        now() - make_interval(mins => ${minutesAgo}), now() - make_interval(mins => ${minutesAgo})) returning id`;
    for (const source of sources) {
      await sql`insert into idea_mentions (cluster_id, excerpt, spoken_at, confidence, review_status, source)
        values (${c!.id}, ${`they said ${title} on the show tonight`}, now() - make_interval(mins => ${minutesAgo}), 0.9, 'accepted', ${source})`;
    }
    return Number(c!.id);
  };
  await clean();
  try {
    const keep = await idea("a quiz night", 60, ["ambient"]);
    const drop = await idea("a tour of the moon", 120, ["ambient"]);
    const mine = await idea("a listening walk", 180, ["voice", "ambient"]);

    await setupClerkTestingToken({ page });
    await page.goto("/sign-in");
    await clerk.signIn({ page, emailAddress: OWNER_EMAIL! });
    // Home: the quiet link sits beside Heard nearby, plain text, a 44px target each.
    await page.goto("/");
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    const door = page.locator(".heard-door");
    for (const name of ["Heard nearby", "Heard once"]) {
      expect((await door.getByRole("link", { name, exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await door.screenshot({ path: "test-results/heard-once-home-door-phone.png" });
    await page.goto("/garden");
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await expect(page.locator(".idea-card").filter({ hasText: "a listening walk" })).toHaveCount(1);
    await expect(page.locator(".idea-card").filter({ hasText: PREFIX })).toHaveCount(1); // the quiet two are not here
    await page.getByRole("link", { name: "Heard once", exact: true }).click(); // the link has no number

    await expect(page).toHaveURL(/\/heard-once$/);
    await expect(page).toHaveTitle("Heard once · Earmark");
    await expect(page.locator("h1")).toHaveText("Heard once");
    const row = (id: number) => page.locator(`[data-testid="heard-once-row"][data-idea-id="${id}"]`);
    await expect(row(keep)).toContainText("a quiz night");
    await expect(row(keep)).toContainText(/Heard \w{3}, \w{3} \d+, \d+:\d\d [AP]M/);
    await expect(row(keep).locator(".heard-quote")).toHaveText("“they said a quiz night on the show tonight”");
    await expect(row(mine)).toHaveCount(0); // a voice note always shows in the garden, never here
    const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(scroll, "no horizontal scroll").toBeLessThanOrEqual(client);
    const small = await page.locator("#heard-once").evaluate((el) => [...el.querySelectorAll<HTMLElement>("button, a")]
      .filter((b) => b.getBoundingClientRect().height < 44).map((b) => b.textContent));
    expect(small, "tap targets >= 44px tall").toEqual([]);
    await page.screenshot({ path: "test-results/heard-once-phone.png", fullPage: true });

    await row(keep).getByRole("button", { name: "Keep" }).click();
    await expect(row(keep)).toHaveCount(0);
    await expect(page.locator("#heard-once").getByRole("status")).toHaveText(`Kept: ${PREFIX} a quiz night. It’s in your garden now.`);
    await expect.poll(async () => (await sql`select kept_at from idea_clusters where id = ${keep}`)[0]!.kept_at).not.toBeNull();

    await row(drop).getByRole("button", { name: "Dismiss" }).click();
    await expect(row(drop)).toHaveCount(0);
    await expect(page.locator("#heard-once").getByRole("status")).toHaveText(`Dismissed: ${PREFIX} a tour of the moon`);
    await expect.poll(async () => (await sql`select stage from idea_clusters where id = ${drop}`)[0]!.stage).toBe("dismissed");
    const undo = page.getByRole("button", { name: /^Undo/ });
    await expect(undo).toBeFocused();
    expect((await undo.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: "test-results/heard-once-phone-dismissed.png", fullPage: true });
    await undo.click();
    await expect(page.locator("#heard-once").getByRole("status")).toHaveText(`Back: ${PREFIX} a tour of the moon`);
    await expect(row(drop)).toHaveCount(1); // still quiet: back in this list, not the garden
    expect((await sql`select stage from idea_clusters where id = ${drop}`)[0]!.stage).toBe("compost");

    await page.goto("/garden");
    await expect(page.locator(".idea-card").filter({ hasText: "a quiz night" })).toHaveCount(1);
    await expect(page.locator(".idea-card").filter({ hasText: "a tour of the moon" })).toHaveCount(0);

    // Dismiss from an idea's own page, then Undo.
    await page.goto(`/ideas/${mine}`);
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    const dismiss = page.getByRole("button", { name: "Dismiss", exact: true });
    expect((await dismiss.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await dismiss.click();
    await expect(page.getByRole("status").filter({ hasText: "Dismissed. It stays here, greyed out." })).toBeVisible();
    await expect(page.getByText("You dismissed this idea.")).toBeVisible();
    await expect.poll(async () => (await sql`select stage from idea_clusters where id = ${mine}`)[0]!.stage).toBe("dismissed");
    await page.screenshot({ path: "test-results/heard-once-idea-dismissed-phone.png", fullPage: true });
    await page.getByRole("button", { name: "Undo: bring this idea back" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Undone. It’s back where it was." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Dismiss", exact: true })).toBeVisible();
    expect((await sql`select stage from idea_clusters where id = ${mine}`)[0]!.stage).toBe("sprouting");
  } finally {
    await clean();
  }
});
