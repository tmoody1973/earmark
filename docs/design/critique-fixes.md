# Impeccable critique fixes (M4-T10)

Lane B surfaces: Home, Garden, Shelf (Maybe?, card "…", Wikipedia line), People and a person, Spaces list and a Space,
the idea page (backlinks, merge, pins) and Serendipity. One critique round at 1440 / 390 / 320 on seeded TEST data,
one batch of fixes, one confirm round. Critique ran single-context (no sub-agents in this run). Detector
(`impeccable detect --json app`): 0 findings before, 0 after.

| # | View | Finding | Severity | Fix | Status |
|---|---|---|---|---|---|
| 1 | Home, Shelf, Space, person | A tip whose type this build does not know (a `video` row on the test branch) throws in `Artwork` (`ALT[card.variant] is not a function`); the whole page fails to load | P0 | `cardVariant` falls back to the note card (agent/lib/garden/cards.ts, with a unit test). Behavior change | fixed |
| 2 | Person page | A loved tip shows no "Thank Ann": the page blanked `recommender` to hide "from Ann", which also hid the thank link | P1 | `RecCard from={false}` hides only the "from" line | fixed |
| 3 | Idea page | The back link says "Garden" but goes to `/`, which the tabs call Home; the Garden tab is `/garden` | P2 | The link goes to `/garden`, the page it names (with #13) | fixed |
| 4 | Ideas (`/garden`) | Gardeners and Alexa+ links are 26 px tall, underlined body links jammed under the h1 | P2 | Quiet 44 px links in the "See all" style | fixed |
| 5 | Home Maybe? | "and 1 more" is an 18 px tap target | P2 | 44 px inline-flex link | fixed |
| 6 | Shelf card | The Wikipedia source link is a 13 px inline target | P2 | Inline block padding grows the hit area to ~44 px; the line does not move | fixed |
| 7 | Person page, unattributed tips | The short hairline above "from Ann" is drawn even when there is no "from" line: a stray dash over the "…" | P3 | No hairline (and a tighter foot) without `.rec-from` | fixed |
| 8 | A Space | Publish is a link styled as a pill but keeps the body underline, unlike its peers Rename and Delete | P3 | No underline on `.space-tools a.link-btn` | fixed |
| 9 | Home, desktop | The New row is cut hard at the column edge ("Milwaukee Publi") | P3 | Trailing fade plus end padding at ≥ 64rem | fixed |
| 10 | Home 320, a Space | "Look back by who, where or when" and "Still sorting…" wrap to two lines with the icon/dot centred between them | P3 | Icon and dot sit on the first line | fixed |
| 11 | Shelf, Maybe?, search, New chips | Hard-coded `#cdc2b1` / `#d6cbb9` beside the `--hairline-strong` / `--hairline-dashed` tokens | P3 | Tokens | fixed |
| 12 | Spaces list | Row chevron 20 px; People's is 18 | P3 | 18 | fixed |
| 13 | Tabs vs `/garden` | The tab says "Garden", its page says "Ideas", and Home's "Ideas" zone links to it | P2 | Tarik chose "Garden": the `/garden` h1 and tab title, and Home's zone heading. "ideas" stays as a noun in sentences; a Space's own "Ideas" group is not the page and keeps its name | fixed |
| 14 | Map card | The OSM credit is a 24 px target | P3 | Meets WCAG 2.2 AA 2.5.8 (24 px); a 44 px credit would cover the map | declined: meets AA |
