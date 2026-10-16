# Shape brief — published Space page (`app/s/[token]/page.tsx`, built in M5-T14)

Status: **approved by Tarik, 2026-10-16** (M4-T1). Visitor mode: **Read**. Inherits the garden's world, lighter: no tabs, no search, no actions.

## Job and audience
A listener or collaborator opens a link Tarik texted them — e.g. "Heard at Radio Milwaukee this week" or "This Bites: recommended by our guests" — on their phone, with no account. They should see a short, beautiful list of things worth trying and who suggested them, then leave or open an item's link.

## Content and rules
- Title (the Space's one sentence), "Collected by Tarik Moody", date range.
- Approved items only, as the same tip cards without actions; recommender first names only when that person consented; **no conversation excerpts**; ideas never appear.
- Each card links out (Apple Music, map, publisher) — no audio on the page.
- `noindex` by default; works shared by text message (good link preview: title + count + one artwork).
- States: empty Space ("Nothing here yet"), revoked link (polite "This page is no longer shared"), 1–40 items.

## Constraints
WCAG 2.2 AA; fast on a phone over cellular (artwork sized and lazy); no tracking.
