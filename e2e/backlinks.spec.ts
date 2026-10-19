import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { neon } from "@neondatabase/serverless";
import { expect, test, type Page } from "@playwright/test";

// Backlinks on the idea page (M4-T6, FR-38). Writes: TEST branch only (playwright.config.ts points the server there).
// Synthetic rows only, titled "Sample link: …"; links are written directly (the refresh's Jev calls are unit-tested and
// proven once on the test branch, not repeated here).
const OWNER_EMAIL = process.env.E2E_OWNER_EMAIL!;
const HIDE_DEV_BADGE = "nextjs-portal { display: none !important; }";
const DIR = "docs/design/screens"; // git-ignored

async function signInAs(page: Page, emailAddress: string) {
  await setupClerkTestingToken({ page });
  await page.goto("/sign-in");
  await clerk.signIn({ page, emailAddress });
}

test("Connected: keep and remove links, merge a duplicate idea, and undo the merge", async ({ page }, info) => {
  test.skip(process.env.E2E_REAL === "1", "writes: test branch only");
  const sql = neon(process.env.TEST_DATABASE_URL!);
  const width = info.project.name === "phone" ? 390 : 1440;

  // fresh synthetic rows for this run
  const old = (await sql`select id from idea_clusters where title like 'Sample link:%'`).map((r) => String(r.id));
  await sql`delete from links where (from_type = 'idea' and from_id = any(${old})) or (to_type = 'idea' and to_id = any(${old}))`;
  await sql`delete from idea_merges where keep_id = any(${old}::bigint[]) or merged_id = any(${old}::bigint[])`;
  await sql`delete from idea_clusters where title like 'Sample link:%'`;
  await sql`delete from recommendations where raw_text = 'sample-link'`;

  let conv = 8_100_000 + (width === 390 ? 0 : 50);
  const idea = async (title: string, mentions: number) => {
    // kept_at: an idea overheard once is otherwise quiet (decision 055) and would never show as a link
    const [c] = await sql`insert into idea_clusters (title, stage, mention_count, first_mentioned_at, last_mentioned_at, timeline, kept_at)
      values (${`Sample link: ${title}`}, ${mentions >= 3 ? "ready" : mentions === 2 ? "sprouting" : "compost"}, ${mentions},
        now() - interval '9 days', now() - interval '1 day',
        ${JSON.stringify([{ date: new Date(Date.now() - 9 * 864e5).toISOString(), line: "Oct 7: first heard" }])}::jsonb, now())
      returning id`;
    for (let i = 0; i < mentions; i++) {
      await sql`insert into idea_mentions (cluster_id, bee_conversation_id, excerpt, spoken_at, confidence, review_status, source)
        values (${c.id}, ${conv++}, 'a synthetic sample excerpt', now() - make_interval(days => ${9 - i}), 0.95, 'accepted', 'ambient')`;
    }
    return Number(c.id);
  };
  const tip = async (type: string, name: string, creator: string | null, status: string) =>
    Number((await sql`insert into recommendations (type, raw_text, canonical_name, creator, excerpt, said_at, source, status, confidence)
      values (${type}, 'sample-link', ${name}, ${creator}, 'sample excerpt', now() - interval '3 days', 'ambient', ${status}, 0.95)
      returning id`)[0].id);
  const pairLink = (a: number, b: number, kind: string, p: number) =>
    sql`insert into links (from_type, from_id, to_type, to_id, kind, confidence, judged_at)
        values ('idea', ${String(Math.min(a, b))}, 'idea', ${String(Math.max(a, b))}, ${kind}, ${p}, now())`;
  const fitLink = (rec: number, to: number, p: number) =>
    sql`insert into links (from_type, from_id, to_type, to_id, kind, confidence, judged_at)
        values ('rec', ${String(rec)}, 'idea', ${String(to)}, 'fits', ${p}, now())`;

  const me = await idea("An oral history of the station's first broadcast", 2);
  const related = await idea("A newsletter issue on the original transmitter log", 1);
  const weak = await idea("A playlist of new pop releases", 1);
  const twin = await idea("The first night on air, told by the people who were there", 1);
  const record = await tip("album", "Sample Live Recordings, 1962", "The Sample Quartet", "new");
  const book = await tip("book", "Doing Oral History", "A. Sample", "queued");
  const maybe = await tip("other", "Sample maybe tip", null, "needs_review");
  await pairLink(me, related, "related", 0.91);
  await pairLink(me, weak, "related", 0.4); // below LINK_MIN: never shown
  await pairLink(me, twin, "merge_suggestion", 0.88);
  await pairLink(me, twin, "related", 0.95);
  await fitLink(record, me, 0.86);
  await fitLink(book, me, 0.74);
  await fitLink(maybe, me, 0.99); // a maybe is hidden everywhere the shelf hides it
  const status = async (from: [string, number], to: number, kind: string) =>
    (await sql`select status from links where from_type = ${from[0]} and from_id = ${String(from[1])} and to_id = ${String(to)} and kind = ${kind}`)[0]?.status;

  await signInAs(page, OWNER_EMAIL);
  await page.goto(`/ideas/${me}`);
  const panel = page.locator("#links");
  await expect(panel.getByRole("heading", { name: "Connected" })).toBeVisible();
  await expect(page.getByTestId("link-related")).toHaveCount(1); // the twin is offered as "same idea?", not listed twice
  await expect(panel.getByText("A playlist of new pop releases")).toHaveCount(0);
  await expect(page.getByTestId("link-fits")).toHaveCount(2);
  await expect(panel.getByText("Sample maybe tip")).toHaveCount(0);
  await expect(page.getByTestId("link-same")).toHaveCount(1);
  for (const b of await panel.getByRole("button").all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await page.addStyleTag({ content: HIDE_DEV_BADGE });
  await page.screenshot({ path: `${DIR}/m4-links-${width}.png`, fullPage: true });
  await panel.screenshot({ path: `${DIR}/m4-links-panel-${width}.png` });

  // Keep a related idea: the row says Kept, the link is accepted
  const relatedRow = page.getByTestId("link-related").filter({ hasText: "transmitter log" });
  await relatedRow.getByRole("button", { name: /Keep the link/ }).click();
  await expect(relatedRow.getByText("Kept")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Kept the link" })).toHaveCount(1);
  await expect.poll(() => status(["idea", Math.min(me, related)], Math.max(me, related), "related")).toBe("accepted");

  // Remove a tip that fits: gone at once, removed in the table, focus parked on the panel heading
  await page.getByTestId("link-fits").filter({ hasText: "Doing Oral History" }).getByRole("button", { name: /Remove the link/ }).click();
  await expect(page.getByTestId("link-fits")).toHaveCount(1);
  await expect(panel.getByRole("heading", { name: "Connected" })).toBeFocused();
  await expect.poll(() => status(["rec", book], me, "fits")).toBe("removed");

  // Merge asks first; Cancel changes nothing
  const same = page.getByTestId("link-same");
  await same.getByRole("button", { name: "Merge here" }).click();
  await expect(same.getByText("Move its mentions here? You can undo it. Merging may make this idea bloom and start a one-pager.")).toBeVisible();
  await page.addStyleTag({ content: HIDE_DEV_BADGE });
  await panel.screenshot({ path: `${DIR}/m4-links-confirm-${width}.png` });
  await same.getByRole("button", { name: "Cancel" }).click();
  await expect(same.getByRole("button", { name: "Merge here" })).toBeVisible();

  // Merge: the twin's mention moves here (3 → bloomed), the twin shows under Merged in
  await same.getByRole("button", { name: "Merge here" }).click();
  await same.getByRole("button", { name: "Merge", exact: true }).click();
  await expect(page.getByTestId("link-merged")).toHaveCount(1);
  await expect(page.getByTestId("link-same")).toHaveCount(0);
  await expect(page.locator(".idea-stage")).toHaveText("Bloomed");
  await page.addStyleTag({ content: HIDE_DEV_BADGE });
  await page.screenshot({ path: `${DIR}/m4-links-merged-${width}.png`, fullPage: true });

  // The merged idea's own page says where it went and offers Undo
  await page.getByTestId("link-merged").getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/ideas/${twin}$`));
  await expect(page.getByText("Merged into")).toBeVisible();
  await expect(page.locator("#links")).toHaveCount(0);
  await page.addStyleTag({ content: HIDE_DEV_BADGE });
  await page.screenshot({ path: `${DIR}/m4-links-merged-into-${width}.png`, fullPage: true });
  await page.getByRole("button", { name: "Undo merge" }).click();
  await expect(page.getByText("Undone: this is its own idea again.")).toBeVisible();
  await expect(page.getByText("Merged into")).toHaveCount(0);
  await expect(page.locator(".idea-stage")).toHaveText("Compost");

  // Back on the first idea: two mentions again, no merge, and "same idea?" is not offered again
  await page.goto(`/ideas/${me}`);
  await expect(page.locator(".idea-stage")).toHaveText("Sprouting");
  await expect(page.getByTestId("link-merged")).toHaveCount(0);
  await expect(page.getByTestId("link-same")).toHaveCount(0);
  await expect(page.getByTestId("link-related").filter({ hasText: "The first night on air" })).toHaveCount(1); // still related
  expect((await sql`select count(*)::int as n from idea_mentions where cluster_id = ${twin}`)[0].n).toBe(1);
});
