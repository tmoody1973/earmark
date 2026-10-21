# 064 — When a recommended artist plays near home, Earmark says so

**Decision:** Once a day, for each artist and album tip Tarik hasn't cleared, the background agent searches the web for that artist's upcoming shows near his home city. It keeps only shows with a date, a venue and a source page, in the next 30 days, within 150 km of home. The tip's page lists them under "Playing nearby", and the next show becomes one Bee todo ("Sault plays Cactus Club Sat Nov 7") that rings the morning before.

**Why this came up:** On Oct 21 Tarik asked for an agent that acts before he asks. A friend's recommendation of a band is most useful the week that band comes to town, and nobody checks tour pages for every tip they've been given. If we got it wrong, either the wrist fills with shows in other states or with dates the web made up, or the feature quietly costs searches every few minutes.

**Options:**
1. **A daily web search per tip, one model read, strict filters, one todo per tip** (chosen). Cost: one TinyFish search (free) and one model call per tip per day, at most 5 tips a run; a show missing from the top 5 search results is missed.
2. **A concert listings service (Songkick, Bandsintown, Ticketmaster).** Cost: a new account and key, terms that limit how the data may be shown, and each covers only the venues it sells for. More reliable dates, but another service to sign up for during a hackathon.
3. **Leave it to Tarik: a "check tour dates" link on the tip page.** Cost: nothing happens unless he remembers to tap it, which is the problem we started with.

**What we chose and why:** Option 1. Tarik approved it on Oct 21; Claude built it. It reuses what decision 051 already proved: the same free TinyFish Search (a web search service), the same kind of single model call told that the search results are untrusted data, and the same Bee todo machinery as decision 062 (its switch, its limit of 10 open Earmark todos, its link back to the tip). Rules we kept:
- The search words are the artist's name, "tour dates" and the home city. Never what anyone said, never a person's name.
- A show is kept only with an exact date, a venue, a city and the search result it came from, and only from today to 30 days out. Every kept show links to that page, so a wrong answer can be checked in one tap.
- "Near" means the home city by name, or a city that OpenStreetMap's place search (Nominatim, the free map lookup the app already uses) finds within 150 km of home. That covers Chicago and Madison from Milwaukee. If the lookup fails, the show is dropped for the day.
- Each tip is checked at most once a day. The time of the last check sits in the tip's existing `extras` data, so no database change was needed.
- One todo per tip, updated in place to name the next show. A show is told once, ever, even across tips: an album tip by an artist whose show was already told makes no second todo.
- A show todo never holds one of the 10 slots past its use. It is marked done the day after its show, unless a newer show is waiting to be named, and also when its tip is dismissed or composted. That happens right away, with every regular pass as the backstop.
- The todo rings at 15:00 UTC the day before (10 am in Milwaukee in summer time, 9 am in winter). A show today or tomorrow rings in a minute.
- No tickets are ever bought, and no paid automation runs. Everything is off while the TinyFish key or the home location is missing.

**What we gave up:** Only artist and album tips that a catalog already matched are checked. A misheard name would search for the wrong band, so a tip still waiting on "Which one?" gets no shows until it is settled. A show todo stays open, holding one of the 10 slots, from the day it is made until the day after the show, which can be up to a month. If Tarik ticks it off early, the next show for that tip makes a new todo. The answer is only as good as the top 5 search results: a small-venue show that only appears on the venue's own calendar can be missed. Tips are checked newest first, 5 at a time, so with more than about 700 standing artist and album tips some would wait longer than a day.

**How we'll know if this was right:** Over two weeks, open the source link of every show it finds and count how many were real, on that date, at that venue. Fewer than 9 in 10 means the filters are too loose. Also count how often a show todo was the one that hit the 10-todo limit.

**What actually happened:**
