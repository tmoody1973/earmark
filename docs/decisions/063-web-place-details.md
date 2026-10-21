# 063 — Places found on the web get their hours and phone from the web, credited to the page

**Decision:** When a place tip was matched from the web (decision 059) and so has no OpenStreetMap entry, Earmark now reads its details (what kind of place, opening hours, phone, website, menu) from the place's own web page, and "The place" on the tip page says "Details from <that site>" with a link, instead of the OpenStreetMap credit.

**Why this came up:** Decision 059 made Diaspora (a Milwaukee bar, tip 130) findable, but a place found that way has an empty "The place" section: hours and phone came only from OpenStreetMap (decision 058), and OpenStreetMap doesn't know the bar. The tip page is where Tarik checks "is it open?" before heading out, so the places most likely to be small local spots were the ones with nothing to show. The demo video shows a place tip.

**Options:**
1. **Read the place's own page** (chosen). One free TinyFish search for "<name> <address> hours", then TinyFish's page reader on the best page, then one model call that pulls out the facts. Cost: a web page can be wrong or stale, and a model can misread it; each place costs one search, one page read and one model call, once.
2. **Search snippets only, never open a page.** Cheaper and simpler. Cost: snippets are short and often cut off before the hours, so most places would still show nothing. We keep this as the fallback when no usable page exists.
3. **Leave web-found places without details** and let Tarik add the place to OpenStreetMap by hand. Cost: nothing built, but the demo place stays empty, and OpenStreetMap's rules don't allow copying in data from websites automatically (decision 059).

**What we chose and why:** Option 1, with option 2 as the fallback. Tarik approved it on Oct 21; Claude built it. Facebook, Instagram, TikTok, X/Twitter and Threads pages are never opened: they sit behind logins, and what they say isn't ours to store. The web search uses only Earmark's own words (the place's name and street address), never the transcript or anyone's name. Hours go through the same checks as OpenStreetMap's: hours the app can't read, or spans over 16 hours that are almost certainly typos, are dropped rather than shown. The model is told to leave anything the page doesn't state empty. It runs for a place with a web link or a street address (the tip's own link is read first when there is one; otherwise the best non-social search result). Diaspora was saved with an address but no link, so requiring a link would have skipped it. A place with neither is skipped as too ambiguous. A one-off script, `pnpm requeue:place-details` (dry run by default), sends already-looked web places back through the step. The work happens inside the existing "extras" step, so it keeps that step's per-run cap and its three tries, and it is off, quietly, when there is no TinyFish key.

**What we gave up:** A web page can be out of date, and Earmark shows what it read as fact, with a link so Tarik can check. We store a few facts from the page (hours, phone, links), not its text. Places with only a social-media page, and nothing else on the web, still show no details. Each web-found place costs one extra model call, once.

**How we'll know if this was right:** After a week, open the web-found place tips (starting with Diaspora). Count how many show hours, and spot-check five against the places' own pages or by calling. If more than one in five is wrong, the page-reading step needs tightening or the section needs a "check before you go" note.

**What actually happened:**
