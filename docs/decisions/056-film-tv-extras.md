# 056 — Film and TV tips get a synopsis, cast, where to watch and a trailer, fetched once from TMDB

**Decision:** A film or TV tip's page now has a "The film" or "The show" section: the synopsis, a line with the year, the running time (or seasons and episodes) and genres, who directed or created it, the top four cast, and where to watch it in the US (streaming first, then free, then rent or buy, each with the service's logo and name). If TMDB lists an official YouTube trailer, the poster gets a Play button that loads the trailer only when tapped. All of it comes from one TMDB request per tip, made once by the background enrichment sweep (the "rec lane") and stored with the tip's other extras, exactly as decision 045 does for songs, podcasts and books.

**Why this came up:** A film tip's page showed a poster, a year and a TMDB link, and nothing else, while a book showed its description and a song played a preview. The point of the page is to help Tarik decide whether to try a tip, and for a film the two questions are "what is it?" and "where can I watch it tonight?". What was at stake: getting TMDB's attribution terms wrong (the where-to-watch data belongs to JustWatch and must be credited), and adding page-load requests that leak what Tarik is looking at.

**Options:**
1. **One TMDB request per tip in the existing extras step, stored on the tip** (chosen). Cost: where-to-watch goes stale (a film leaves Netflix and the page still says Netflix), and it reaches existing tips only after a one-off script is run.
2. **Ask TMDB live when the page opens.** Cost: always fresh, but every page view tells TMDB what Tarik opened, the page waits on TMDB, and decision 045 rules this out for every other kind of tip.
3. **Synopsis and cast only, no where to watch.** Cost: skips the JustWatch credit and the staleness problem, but drops the most useful part.

**What we chose and why:** Option 1, from Tarik's brief; Claude designed the details.
- **One request.** `GET /3/{movie|tv}/{id}?append_to_response=credits,videos,watch/providers` (TMDB's "append to response" adds the cast, videos and providers to the main answer). The id and kind come from the tip's stored TMDB link (`links.tmdb`, written by the matcher). The token is the existing `TMDB_API_KEY`, passed in by the lane, never read inside the fetch code.
- **Same rules as the other extras (045).** A "slow down" answer (HTTP 429/503) stops the step without counting against the tip; any other failure counts a try; after 3 tries the tip is left alone. No token means no request and no film section.
- **What is kept.** The synopsis is cut at 600 characters at a word. At most 3 genres, 3 directors or creators, 4 cast names, and 6 services per watch group ("More ways to watch" links to TMDB's full list). The trailer is the first official YouTube "Trailer", else the first official "Teaser"; unofficial uploads and other video sites are ignored. Logos are stored as full `https://image.tmdb.org/...` addresses; the page re-checks every stored link and logo against TMDB's own hosts before showing it.
- **Credits.** "Where to watch data by JustWatch", linked to justwatch.com, sits directly under the providers, as TMDB's terms require. The existing TMDB credit line stays, and the About page now names JustWatch too.
- **The trailer** reuses the tap-to-load player from 045: the poster and a Play button, and YouTube's privacy-enhanced player only after a tap.
- **Existing tips.** A tip whose extras were already fetched is never fetched again, so `pnpm requeue:film-extras` (a dry run unless given `--yes`, ids and counts only) sends matched film tips with a TMDB link and no film section back to the extras step. Their stored extras (such as the Wikipedia passage) are kept; the new section is merged in.

**What we gave up:** Where-to-watch is a snapshot from the day of the sweep and is never refreshed, so it will drift. It is US only. The provider logos load from TMDB's image server when the page opens, like the posters already do. Existing tips need Tarik to run the backfill script once; nothing does it automatically. A show's cast is TMDB's cast for its latest season, not the whole run.

**How we'll know if this was right:** After the backfill and a week of sweeps, count how many matched film tips have a `film` section (expect nearly all) and how many have a trailer and at least one provider. If Tarik reports a provider that's wrong for more than a month-old tip, add a refresh rule for `watch` only.

**What actually happened:**
