# Shape brief — the garden (`app/page.tsx`)

Status: **approved by Tarik, 2026-10-16** (M4-T1). Visitor mode: **Operate** (glance, then act).

## 1. Job and audience
Tarik, on his phone, after a walk, a call or a show; sometimes at his desk. He opens Earmark to answer one question in seconds: **"What did Earmark catch since I last looked?"** Then he either opens something (a bloomed idea's one-pager, a tip) or tidies it (keep / dismiss an unsure item, mark a tip tried).

## 2. Outcome and proof
- Success: within one glance he sees what's new, who it came from, and which ideas grew — without scrolling.
- Product truths the page must show, never fake: every tip carries the **first name** of who said it (or no name when unknown — never a guess); ideas **grow with each mention** and **bloom at the third**; unsure items are visibly unconfirmed.
- Real material: Apple Music / Cover Art Archive album art, TMDB posters, Google Places photo or an OpenStreetMap tile, podcast artwork, book covers; context summaries ≤ 30 words; excerpts ≤ 25 words.

## 3. Selected direction
- **The category standard, played straight** (Tarik's pick from the mock): calm personal-knowledge garden in the mymind tradition — warm off-white ground, near-black type, a confident serif for item titles, a quiet sans for metadata, **one orange accent**, artwork-led cards with soft corners, generous space.
- **Craft bar:** mymind (calm cards, search as a door), Apple Music / Podcasts (artwork-led cards, native phone feel), Readwise Reader (reading quality — governs the idea page), Things 3 (restraint, tiny delightful interactions).
- **One colour, one meaning:** orange marks *new since last time* and the live bloom; it is not decoration.
- **Plants:** each idea card carries a small plant drawn at its stage (compost → sprouting → ready/bloom → drafted → used). The bloom is the one moment of motion on the page.
- Copy: wordmark **Earmark**, tagline **"Small moments. A bigger mind."** (approved). No other invented slogans.

## 4. Scope and boundaries
- This brief covers the garden page and its tab shell. Separate briefs: idea detail, rec card set, published Space page.
- **Anti-goals:** dashboard numbers, charts, streaks, a social feed, likes, play buttons or audio, photos of recommenders, invented quotes (every quote on a card is a real context summary or excerpt).

## 5. Layout (phone first)
1. **Header:** Earmark wordmark + tagline, small sprout mark.
2. **Search:** "Search what you heard…" — memory-cue search (FR-36, built in M5-T8); until then it filters titles and names on the page.
3. **New since last time:** a horizontal row of compact chips — type icon, title, "from Ann · place"; blooms appear here as "Bloomed · 3 mentions". Orange dot. "See all".
4. **Zone 1 — The garden (ideas):** bloomed and newly grown ideas first; each card = plant at its stage, the idea's title, mention count, the newest timeline line. Unconfirmed ideas look quieter (lighter plant, outline card, "Unconfirmed · keep / dismiss").
5. **Zone 2 — The shelf (tips):** two-column, artwork-led, type-aware cards (see rec-card brief): type label with icon, title, creator, the "why" in quotes, "from Ann". Needs-review tips marked like unconfirmed ideas.
6. **Bottom tabs:** Home (this page) · Garden (ideas only) · Shelf (tips only) · People (who recommended what — taste ledger, M4-T5). No "Saved" or "Profile".
- **Desktop:** same order; the shelf widens to 3–4 columns; tabs become a quiet left rail.

## 6. States and ranges
- 0–60 ideas, 0–60 tips; titles 2–12 words; summaries ≤ 30 words.
- **Day one / empty:** a calm explanation and the one action — "Say 'Earmark that, Ann's ramen spot' to your Bee" — no fake content.
- **Live bloom** (polling every 5 s): the plant grows to bloom in place, a "Bloomed" chip slides into the New row, and a screen-reader announcement fires. Reduced motion: jump to the final state.
- **Many items:** zones show the newest ~6 then "See all" into the tab.
- **Missing artwork:** every card type has a designed no-image state (never a broken image).
- **Judges' demo mode:** same page, read-only, invented sample data labelled as sample.

## 7. Constraints and open decisions
- WCAG 2.2 AA; tap targets ≥ 44 px; works at 320 px wide; first names only.
- Keep test hooks: `<main id="garden">`, `data-testid="plant"` + `data-cluster-id` on each plant root, `data-testid="rec-card"` + `data-variant` on each card.
- Fonts chosen at build to the craft bar (a real text serif for titles, a workhorse sans for UI) — not decided here.
- **Decided (Tarik):** place cards show the venue photo when Google Places returns one, an OpenStreetMap tile with a pin otherwise (attribution shown).
