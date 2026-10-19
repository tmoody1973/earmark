# 051 — Find it on the web when every catalog comes up empty

**Decision:** When no catalog can match a tip, the rec lane now asks the web once, using TinyFish Search. The search words are Earmark's own: the tip's name, the creator, the kind of thing, and the "why" line. Bee's quote is never sent. A small model reads the top five results and names up to three likely titles. Earmark then looks each title up in the tip type's normal catalog. A tip is settled automatically only when the web gave exactly one title and exactly one catalog item has that same name and creator. Anything less certain becomes a "Which one?" choice for Tarik (decision 048). A web answer never settles a tip by itself.

**Why this came up:** Bee often hears a description, not a title: "Jimetta Rose's Sun Ra-inspired album". Every catalog Earmark uses (MusicBrainz and Apple Music together per decision 050, Open Library, TMDB, the iTunes podcast search, Wikipedia) searches by title, so a description finds nothing. The tip then sits unmatched, with no art and no link, until Tarik fixes it by hand. A web search is what a person would do: type the description, read the result titles, spot the album's name. If this goes wrong in one direction, a confident wrong title gets attached to a tip and Tarik has to notice it. If it goes wrong in the other, it is a paid service doing nothing useful.

**Options:**
1. **TinyFish Search, plus one cheap model call to read the result titles.** TinyFish is a web search API with 12,000 free searches a day. It returns several ranked results, each with a URL. Cost: two steps instead of one, plus a new account and key.
2. **Perplexity Sonar through the AI Gateway (the model router Earmark already uses).** Sonar is a model that searches the web and answers in one call. Cost: about ten times the tokens per lookup. It returns one answer rather than results we can check, and gives no URL to offer when no catalog has the item.
3. **context.dev.** A hosted search-and-context service. Cost: another vendor for the same job, and it was not in the bake-off, so we have no evidence it names the right item.

**The bake-off** (`.superpowers/sdd/2026-10-16-earmark/carry/websearch-bakeoff.mts`): six invented descriptions (no real speech), such as "Colson Whitehead heist novel set in Harlem" and "Apple TV show where office workers have their memories split".

| | Right item named first | Tokens per lookup | Free allowance | Returns options and URLs |
|---|---|---|---|---|
| TinyFish top 5 titles → EXTRACT_MODEL | 6 of 6 | ~650–1,100 | 12,000 searches/day | Yes |
| Perplexity Sonar (one call) | 6 of 6 | ~5,800–7,300 | None | No (one answer) |

**What we chose and why:** Option 1, chosen jointly. Tarik chose TinyFish after the bake-off, and asked that "if there's more than one possible match, pull up options to approve." Both tools were equally accurate, but TinyFish used about a tenth of the tokens. Its results come with URLs, which matter when the item exists only on Bandcamp. Claude chose how it plugs in:
- It is a new step at the end of each lane run, after the why lines are written (the search uses the why) and before embeddings. It picks up to **3** tips per run that ended "no match", haven't been looked for on the web, and whose options Tarik hasn't searched himself. Each tip costs at most 1 TinyFish search, 1 model call (EXTRACT_MODEL, the model already used for extraction), and 3 catalog searches. Jev (the matching model) is never called. Video and place tips are skipped: a video lookup needs a URL, and the place search already takes free text.
- The search query is at most 120 characters. TinyFish is told the purpose ("identify the exact title of a recommended album"). The model sees only those words and each result's title, site and snippet. It does not see URLs; it names a result by number.
- Confirming in the catalogs: for each title the model names, Earmark runs the tip type's normal search (music: MusicBrainz and Apple together). A catalog item counts only if its name and creator equal the title and creator, ignoring case, accents and punctuation. This is the same rule as the exact-match fix in decision 050. One title plus one such item means **matched**, through the lane's normal save. Art, links, the Wikipedia note and extras then follow as usual. Several titles, or several items, become **"Which one?" options**, listed before any options the catalogs offered earlier.
- If no catalog has any of the titles (a Bandcamp-only release), the result the model named as the item's own page becomes **one "Which one?" option**. That page is never fetched during the run. Only if Tarik picks it does Earmark settle the tip through the existing Link path (decision 049). That path fetches the page with its safety checks: public hosts only, each redirect re-checked, 5 seconds, 1 MB. The picked title and creator become the tip's words.
- **Once per tip:** a new column, `web_looked_at` (migration 043), is set when the look is done, whatever it found. If TinyFish or a catalog refuses (402 "allowance used up", 429 "slow down", 503 "busy", 401), the tip is left as it was, the step stops for this run, and the next run tries again. Any other failure, such as the model erroring or timing out, ends that tip's one look, so a bad answer never costs a call every run. When Tarik fixes a tip's words, the column is cleared, and the new words get their own look.
- Off entirely while `TINYFISH_API_KEY` is unset. The lane then behaves exactly as before.
- **Privacy:** only derived words leave Earmark, never Bee's quote. Logs carry the tip id, the stage and the error's name. They never contain the query, the titles, the snippets or the URLs.

**What we gave up:**
- A new outside service and key. When TinyFish is down or out of free searches, unmatched tips simply stay unmatched until it's back.
- The why line is part of the query, so it can carry more of what was said than the name alone (a reason, a place). It can also name the person who recommended the tip ("Ann says…"): that first name, and Tarik's, are taken out before the search, whole words only. The quote never goes.
- An item with no creator never settles automatically (an artist tip, or a title the model gave without a creator). It always becomes a choice for Tarik. A bare title is too common to trust on its own.
- If the model gives a wrong title that happens to match a real catalog item by the same creator exactly, the tip is matched to it without Jev's second opinion. That needs the web and the model to be wrong in a very specific way, which we judged rare. "Not the right one?" (decision 048) still lets Tarik correct it.
- A timeout from TinyFish or the model uses up the tip's one look; it is not retried.
- Tips that were already unmatched before this shipped are also looked for, 3 per run, newest first. That is up to 3 searches and 3 model calls per run until the backlog is through.
- One more column on the tips table, and the "Which one?" option list can now hold a web page as well as catalog items.

**How we'll know if this was right:** Once the key is set, the database can show how often the web look matched a tip, offered options, or found nothing, and how often Tarik later corrected a web match:

```sql
-- Tips the web was asked about, and how each one ended.
select id, canonical_name, creator, enrichment_status, match_source, owner_pick, web_looked_at,
  exists (select 1 from jsonb_array_elements(match_candidates) c where c->>'provider' = 'web') as offered_a_web_page
from recommendations
where web_looked_at is not null
order by web_looked_at desc;
```

If more than about one in five automatic web matches are later corrected (`match_source = 'owner'` with a different `owner_pick`), the exact-name rule is too loose for web titles. If most looks end with nothing (no match, no options), the query words are too thin, and the why line or the purpose needs work.

**What actually happened:**
