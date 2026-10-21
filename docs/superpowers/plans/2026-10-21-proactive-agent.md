# Proactive agent: five things Earmark does before Tarik asks — plan

**Goal:** When Tarik records something, Earmark acts on it without being asked: it researches a bloomed idea, adds music to his Apple Music, checks in on his wrist when it isn't sure, fills in a web-found place, and tells him when a recommended artist plays nearby.

**Why now:** Tarik, Oct 21: "the power of agents … would impress the judges." Proactivity on real data is the Bee track's core ask. Decisions 059/060 (Diaspora found by the agent with nobody touching it) proved the pattern this morning.

**Spec:** `docs/Earmark — PRD-2.md` (FR-15 playlist, FR-16 nudges, FR-24 receipts, the video script) and `docs/superpowers/plans/2026-10-16-earmark.md` Task M3-T6 (the Apple Music plan, already written and reviewed; this plan follows it).

## Global constraints (unchanged, binding on every task)

- Never open, read, list or quote `evals/triage/data/*` (real speech). Every dispatch carries this line.
- Nothing Bee transcribed leaves Earmark: web queries, model prompts and Bee todo text use derived words only (names of items, summaries), never excerpts, never a person's name (todo-text.ts rules).
- Logs: ids and `err.name` only. Excerpts ≤ 25 words. First names only. The repo is public.
- Bee writes only while `BEE_TODO_WRITES=on`; all Earmark todos share the cap of 10 open.
- TinyFish Search and Fetch only (free reads), never paid automation. Every new web step is off while `TINYFISH_API_KEY` is unset.
- No migrations are needed (Apple's token table exists in 001). If one becomes needed, it reaches prod before its PR is handed over.
- e2e never writes production. Integration tests run on the Neon TEST branch only.
- Each feature: tests first, unit + integration green, one real-data check on prod with evidence, its own PR, decision doc with "What actually happened" blank.

## The five features

### 1. Research on bloom (decision 061) — ~1 h

**What happens, in order:** an idea reaches its third mention and blooms → the one-page draft is written straight away, as today (the video's live moment stays fast) → the same save also requests research for that idea → the next rec-lane pass (≤10 min) searches the web, reads the best pages and writes the sourced brief → Tarik's wrist buzzes once: "'<idea>' bloomed: draft and research ready".

- Modify: `agent/lib/pipeline/ingest.ts` (after `draftBlooms`, call `requestResearch(clusterId)` per bloomed cluster), `agent/lib/ideas/research.ts` (todo title says "bloomed" when the cluster is past bloom).
- Ruling: the draft is not rewritten when research lands later (the brief shows under the draft on the idea page). Cost if wrong: the one-pager lacks a "what already exists" paragraph; a redraft step can follow.
- Tests: bloom requests research once (not on later mentions); research already requested/recent → no second request; todo text for a bloomed idea.
- Real check: the bloom rehearsal itself. After mention 3: draft present, research status running → done, one Bee todo.

### 2. Apple Music "Earmarked" playlist (M3-T6, FR-15) — ~3–4 h

**What happens:** Tarik signs in to Apple Music once on `/music` (Apple's own MusicKit sign-in) → Earmark stores his music token encrypted → from then on, every matched song or album tip is added to a playlist called "Earmarked" in his own library on the next lane pass (an album adds its top song) → the tip shows "In your Earmarked playlist".

- Follow M3-T6 in the Oct 16 plan (files, interfaces and tests listed there), reconciled with today's code: the `apple_music_auth` table already exists (001); an owner check already exists (`requireOwner`/`assertOwner` used by receipts and gardeners: reuse it, don't create a second); replace the stub in `agent/lib/mcp/playlist-seam.ts` so the Alexa/MCP "add to playlist" path uses the real one.
- Needs from Tarik: an active Apple Music subscription; one sign-in on `/music` in Safari; OK to add `MUSIC_TOKEN_KEY` (the encryption key) to Vercel prod.
- Risks: MusicKit sign-in in a Next 16 page (Apple's script from its CDN); Apple tokens expire (~6 months) → tips wait with "no_auth", page asks to reconnect.
- Shazam feeds it: song capture is already built (`app/api/capture/song`, setup in `docs/SETUP.md` "Capture a song"). Press the Action button while a song plays → Shazam names it → the Shortcut posts title, artist and Apple Music link → Earmark saves a song tip linked to the Bee conversation you're in → the next lane pass adds it to "Earmarked". No new code for Shazam itself; Tarik builds the Shortcut once.
- Real check: one real Shazam capture lands in the Earmarked playlist in the Music app; screenshot. (No copyrighted audio audible in the video.)

### 3. "Is this the one?" on the wrist (decision 062) — ~1 h

**What happens:** the agent stores options it isn't sure about ("Which one?": the second look, or a web find like Diaspora's) → it makes one Bee todo: "Is this Diaspora Sports Bar and Lounge? Confirm in Earmark" with the tip's link → Tarik picks (or None) on the page → the todo completes itself.

- Modify: `agent/lib/recs/lane.ts` (after options are saved by the second look or `saveWebCandidates`: `createEarmarkTodo({ entityType: "which_one", entityId: recId, … })`), `agent/lib/recs/which-one.ts` (pick / None completes it), todo text via the existing todo-text rules (item name only).
- Ruling: one todo per tip, ever (refresh in place if options change); never for the owner's own Search again (he's already there).
- Tests: one todo per tip; owner search makes none; pick and None complete it; cap reached → skipped, tip unaffected.
- Real check: the next ambiguous real tip produces a todo on the phone.

### 4. Details for a web-found place (decision 063) — ~2 h

**What happens:** a place matched from the web (no OpenStreetMap entry, so no hours today) → the lane's extras step searches the web for its name + address + "hours" and reads the best non-social page with TinyFish Fetch → one model call extracts kind, hours, phone, website, menu in the same shape as the OSM details → "The place" shows them, credited "From <site>" instead of OpenStreetMap.

- Modify: `agent/lib/enrich/place-details.ts` (a `fromWeb` reader into `PlaceExtras`, `source` field), `agent/lib/recs/lane.ts` extras step (web_place matches only), `app/tips/[id]/PlaceDetails.tsx` (credit by source).
- Ruling: Facebook/Instagram pages are skipped (login walls; their text isn't ours to store); hours go through the existing `parseHours` checks, so unparseable hours stay hidden.
- Tests: extraction → `PlaceExtras`; social URLs skipped; bad hours hidden; credit line by source.
- Real check: Diaspora (tip 130) after Tarik confirms it.

### 5. "The artist Ann recommended plays Milwaukee" (decision 064) — ~3 h

**What happens:** once a day, for artist and album tips Tarik hasn't cleared, the agent searches the web for upcoming shows near his home city → one model call keeps only dated shows within 150 km in the next 30 days, with venue and a source link → the tip page shows "Playing nearby: Fri Nov 7, Cactus Club" → one Bee todo per show ("<artist> plays Cactus Club Fri Nov 7"), alarm the day before.

- Modify: `agent/lib/recs/lane.ts` (a daily shows step, ≤5 tips a run), new `agent/lib/recs/shows.ts`, `extras.shows` (no migration: extras is JSON), tip page section.
- Ruling: no ticket buying, no paid automation; a show without a date and a venue is dropped; a show is buzzed once.
- Tests: query words (artist + city only); parsing drops undated/far/past shows; once-per-show todo; daily cap.
- Real check: run on Tarik's real artist tips; report counts; screenshot any found show.

## Order, lanes and schedule (Oct 21)

Each feature runs in its own worktree with its own subagent; I review every diff and merge one at a time (features 2, 3 and 5 all touch `lane.ts`, so they merge in order and rebase).

| Time (CDT) | Lane | Work |
|---|---|---|
| 07:45 → 09:30 | A | **3** Is this the one? |
| 07:45 → 09:30 | B | **1** Research on bloom |
| 07:45 → 12:00 | C | **2** Apple Music (Tarik signs in when the page is up) |
| 09:30 → 11:30 | A | **4** Web place details |
| 12:00 → 15:00 | A | **5** Shows nearby |

Recording follows the merges: bloom and Diaspora beats once 1 and 3 are live (~10:00); the playlist beat once 2 is live (~13:00); place-details and shows inserts late afternoon or Oct 22 morning. If a feature isn't verified on real data in time, its beat moves to the closing "what's next" slide; nothing is faked on camera.

## Review focus (what could bite Tarik, not covered by the happy-path tests)

1. Bee todo flood: five sources sharing a cap of 10; a burst of shows must not crowd out tip todos.
2. A wrong web answer presented as fact (address, hours, show date): always a source link, never auto-settled.
3. Apple token expiry or a revoked sign-in: tips must wait quietly, not error or retry hot.
4. Research and shows cost per day: caps per run; TinyFish refusals back off, never loop.
5. Privacy: no excerpt or person's name in any query, prompt, todo or log.

## Needs from Tarik

- OK to start (and confirm the subagent-per-feature method below).
- For 2: Apple Music subscription, one sign-in, OK to add `MUSIC_TOKEN_KEY` to Vercel prod; build the "Earmark this song" Shazam Shortcut from `docs/SETUP.md` (~5 min) so the playlist beat has a real capture.
- Merge each PR when I hand it over (`! gh pr merge N --merge`).
