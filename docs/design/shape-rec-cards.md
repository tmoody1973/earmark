# Shape brief — the tip card set (`app/garden/cards/`)

Status: **approved by Tarik, 2026-10-16** (M4-T1). Inherits the garden's world (`shape-garden.md`); craft bar for cards is **Apple Music / Podcasts** (artwork-led) with **mymind** calm.

## Job
On the shelf, each card must say in one glance: **what it is, who told him, and why it's worth it** — and look right for its kind of thing.

## Anatomy (every card)
Artwork area (variant-specific) · type label with small icon ("ALBUM") · title in the serif · creator line when known ("Sault") · the "why" in quotes, ≤ 30 words, from the real context summary · "from Ann" (or no name when unknown — never a guess) · tried state when set (loved / fine / not for me) as a quiet tag · unconfirmed/needs-review marker when applicable.

## Variants (artwork)
| Variant | Artwork | No-image state |
|---|---|---|
| album, song | square cover (Apple Music → Cover Art Archive) | typographic square: title + artist set in the serif on a tinted ground |
| artist | portrait-free: artist name set large over a tinted ground (no photos of people unless official artwork) | same |
| book | cover when found; otherwise a spine/jacket with the title set vertically, deterministic hue | spine |
| place | venue photo (Google Places) → OpenStreetMap tile with pin + address (attribution) | map tile |
| podcast | square show artwork (Podcast Index) | typographic tile |
| film / TV | poster ratio (TMDB) | typographic poster |
| other | a note card: title + the why | itself |

## Rules
No play buttons, no audio, no autoplay. Images lazy-load with fixed aspect boxes (no layout jump). Whole card is one tap target to the detail; secondary actions (tried, keep/dismiss) are separate ≥44 px targets. Keep `data-testid="rec-card"` + `data-variant`. WCAG 2.2 AA (text over artwork never; text sits below the art).
