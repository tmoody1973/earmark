import { randomUUID } from "node:crypto";
import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { neon } from "@neondatabase/serverless";
import { expect, test, type Page } from "@playwright/test";

// Smart Spaces (M4-T7, FR-32). Writes: TEST branch only (playwright.config.ts points the server there). Synthetic rows
// only ("Sample space: …"). No model calls: the test holds the evaluate lock, so the first fill a new Space starts finds
// it busy and does nothing; Jev's judgements are written directly (the evaluate pass is unit- and integration-tested).
const OWNER_EMAIL = process.env.E2E_OWNER_EMAIL!;
const HIDE_DEV_BADGE = "nextjs-portal { display: none !important; }";
const DIR = "docs/design/screens"; // git-ignored
const LOCK = "spaces_evaluate_lock";

async function signInAs(page: Page, emailAddress: string) {
  await setupClerkTestingToken({ page });
  await page.goto("/sign-in");
  await clerk.signIn({ page, emailAddress });
}

test("Spaces: describe one, Earmark fills it; keep, remove, rename and delete", async ({ page }, info) => {
  test.skip(process.env.E2E_REAL === "1", "writes: test branch only");
  const sql = neon(process.env.TEST_DATABASE_URL!);
  const width = info.project.name === "phone" ? 390 : 1440;
  const noOverflow = async () =>
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  const bigTargets = async (scope = page.locator("main")) => {
    for (const b of await scope.getByRole("button").all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  };

  const token = randomUUID();
  await sql`insert into sync_cursors (name, cursor) values (${LOCK}, ${token})
            on conflict (name) do update set cursor = excluded.cursor, updated_at = now()`;
  try {
    await sql`delete from spaces where rule_sentence like 'Sample space:%'`;
    await sql`delete from idea_clusters where title like 'Sample space:%'`;
    await sql`delete from recommendations where raw_text = 'sample-space'`;

    let conv = 8_200_000 + (width === 390 ? 0 : 50);
    const idea = async (title: string, mentions: number) => {
      const [c] = await sql`insert into idea_clusters (title, stage, mention_count, first_mentioned_at, last_mentioned_at, timeline)
        values (${`Sample space: ${title}`}, ${mentions >= 3 ? "ready" : mentions === 2 ? "sprouting" : "compost"}, ${mentions},
          now() - interval '9 days', now() - interval '1 day',
          ${JSON.stringify([{ date: new Date(Date.now() - 9 * 864e5).toISOString(), line: "Oct 7: first heard" }])}::jsonb)
        returning id`;
      for (let i = 0; i < mentions; i++) {
        await sql`insert into idea_mentions (cluster_id, bee_conversation_id, excerpt, spoken_at, confidence, review_status, source)
          values (${c.id}, ${conv++}, 'a synthetic sample excerpt', now() - make_interval(days => ${9 - i}), 0.95, 'accepted', 'ambient')`;
      }
      return Number(c.id);
    };
    const tip = async (type: string, name: string, creator: string | null, status: string) =>
      Number((await sql`insert into recommendations (type, raw_text, canonical_name, creator, context_summary, excerpt, said_at, source, status, confidence)
        values (${type}, 'sample-space', ${name}, ${creator}, 'A sample reason it came up.', 'sample excerpt', now() - interval '3 days', 'ambient', ${status}, 0.95)
        returning id`)[0].id);

    const segment = await idea("A weekly visit to a different record store", 2);
    const weak = await idea("Fix the office printer", 1);
    const album = await tip("album", "Sample Live Recordings, 1962", "The Sample Quartet", "new");
    const book = await tip("book", "Sample Oral History Handbook", "A. Sample", "queued");
    const maybe = await tip("other", "Sample maybe tip", null, "needs_review");

    await signInAs(page, OWNER_EMAIL);
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Garden sections" });
    await nav.getByRole("link", { name: "Spaces" }).click();
    await expect(page).toHaveURL(/\/spaces$/);
    await expect(nav.getByRole("link", { name: "Spaces" })).toHaveAttribute("aria-current", "page");
    for (const h of await nav.getByRole("link").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) {
      expect(h).toBeGreaterThanOrEqual(44);
    }

    // Create: one labelled sentence; the new Space opens, still sorting (the fill found the lock busy)
    await page.getByLabel("Describe a new Space").fill("Sample space: radio segment ideas");
    await bigTargets();
    await noOverflow();
    await page.addStyleTag({ content: HIDE_DEV_BADGE });
    await page.screenshot({ path: `${DIR}/m4-spaces-list-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: "Create Space" }).click();
    await expect(page).toHaveURL(/\/spaces\/\d+$/);
    const space = Number(page.url().split("/").pop());
    await expect(page.getByRole("heading", { level: 1, name: "Sample space: radio segment ideas" })).toBeVisible();
    await expect(page.getByTestId("space-sorting")).toContainText(/Still sorting \d+ items?/);
    await expect(nav.getByRole("link", { name: "Spaces" })).toHaveAttribute("aria-current", "true");
    expect((await sql`select count(*)::int as n from space_items where space_id = ${space}`)[0].n).toBe(0); // no model call ran

    // No pass running (the lease looks stale, the Space is past its first seconds): the page says the hourly run will
    // finish it, instead of an endless "Still sorting". The lease is fresh again at once, well before the fill's retry.
    await sql`update spaces set created_at = now() - interval '1 minute' where id = ${space}`;
    await sql`update sync_cursors set updated_at = now() - interval '20 minutes' where name = ${LOCK} and cursor = ${token}`;
    await page.reload();
    await sql`update sync_cursors set updated_at = now() where name = ${LOCK} and cursor = ${token}`;
    await expect(page.getByTestId("space-sorting")).toContainText(/\d+ items? still to sort\. Earmark will finish sorting this within the hour\./);

    // Jev's judgements, written as the evaluate pass writes them
    const judge = (type: string, id: number, p: number) =>
      sql`insert into space_items (space_id, item_type, item_id, confidence) values (${space}, ${type}, ${id}, ${p})`;
    await judge("idea", segment, 0.92);
    await judge("idea", weak, 0.3); // below SPACE_MIN: never shown
    await judge("rec", album, 0.81);
    await judge("rec", book, 0.95);
    await judge("rec", maybe, 0.99); // a maybe is hidden everywhere the shelf hides it
    await page.reload();
    await expect(page.getByTestId("space-idea")).toHaveCount(1);
    await expect(page.getByTestId("space-tip")).toHaveCount(2);
    await expect(page.getByText("Fix the office printer")).toHaveCount(0);
    await expect(page.getByText("Sample maybe tip")).toHaveCount(0);
    await bigTargets();
    await noOverflow();
    await page.addStyleTag({ content: HIDE_DEV_BADGE });
    await page.screenshot({ path: `${DIR}/m4-space-${width}.png`, fullPage: true });

    const status = async (type: string, id: number) =>
      (await sql`select status from space_items where space_id = ${space} and item_type = ${type} and item_id = ${id}`)[0]?.status;

    // Keep a tip: it says Kept, and is accepted
    const albumCard = page.getByTestId("space-tip").filter({ hasText: "Sample Live Recordings" });
    await albumCard.getByRole("button", { name: "Keep" }).click();
    await expect(albumCard.getByText("Kept", { exact: true })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Kept “Sample Live Recordings, 1962” in this Space." })).toHaveCount(1);
    await expect.poll(() => status("rec", album)).toBe("accepted");

    // Remove an idea: gone at once, removed in the table, focus held on the Space's name
    await page.getByTestId("space-idea").getByRole("button", { name: "Remove" }).click();
    await expect(page.getByTestId("space-idea")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
    await expect.poll(() => status("idea", segment)).toBe("removed");
    await page.reload();
    await expect(page.getByTestId("space-idea")).toHaveCount(0); // stays out

    // Rename: the name changes, the sentence it fills from stays
    await page.getByRole("button", { name: "Rename" }).click();
    const nameField = page.getByLabel("New name for this Space");
    await expect(nameField).toBeFocused();
    await nameField.fill("Sample space: Segments");
    await page.getByRole("button", { name: "Save name" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Sample space: Segments" })).toBeVisible();
    await expect(page.getByText("Fills from “Sample space: radio segment ideas”")).toBeVisible();
    expect((await sql`select name, rule_sentence from spaces where id = ${space}`)[0])
      .toEqual({ name: "Sample space: Segments", rule_sentence: "Sample space: radio segment ideas" });

    // Delete asks first; Cancel changes nothing
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("Delete this Space? Its ideas and tips stay in your garden.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel" })).toBeFocused();
    await page.addStyleTag({ content: HIDE_DEV_BADGE });
    await page.locator("header.space-head").screenshot({ path: `${DIR}/m4-space-delete-${width}.png` });
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("button", { name: "Delete", exact: true })).toBeFocused();

    // The list shows the renamed Space with its real counts
    await page.goto("/spaces");
    const row = page.getByTestId("space-row").filter({ hasText: "Sample space: Segments" });
    await expect(row).toContainText(/2 items/);
    await expect(row).toContainText("Fills from “Sample space: radio segment ideas”");

    // Delete: back to the list, the Space is gone, its items are not
    await row.getByRole("link").click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByRole("button", { name: "Delete Space" }).click();
    await expect(page).toHaveURL(/\/spaces$/);
    await expect(page.getByTestId("space-row").filter({ hasText: "Sample space" })).toHaveCount(0);
    expect((await sql`select count(*)::int as n from spaces where id = ${space}`)[0].n).toBe(0);
    expect((await sql`select count(*)::int as n from space_items where space_id = ${space}`)[0].n).toBe(0);
    expect((await sql`select count(*)::int as n from recommendations where id = ${album}`)[0].n).toBe(1);

    // 320 wide still works
    if (width === 390) {
      await page.setViewportSize({ width: 320, height: 640 });
      await noOverflow();
      await page.addStyleTag({ content: HIDE_DEV_BADGE });
      await page.screenshot({ path: `${DIR}/m4-spaces-list-320.png`, fullPage: true });
    }
  } finally {
    // the Space goes before the lease: a first-fill retry that wakes after this finds nothing to judge (no model call)
    await sql`delete from spaces where rule_sentence like 'Sample space:%'`;
    await sql`delete from sync_cursors where name = ${LOCK} and cursor = ${token}`;
  }
});
