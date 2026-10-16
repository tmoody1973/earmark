---
version: 1
slug: "app-page-tsx"
primary_target: "app/page.tsx"
related_targets: ["app/ideas/[id]/page.tsx","app/garden/cards"]
---

Scope: the garden (app/page.tsx) and its tab shell (Home · Garden · Shelf · People), plus the idea page and rec card set it links to. Visitor mode: Operate (garden), Read (idea page). Full briefs: docs/design/shape-garden.md, shape-idea-detail.md, shape-rec-cards.md, shape-space-page.md.

## Direction contract

THESIS: A calm personal-knowledge garden for things heard out loud — the mymind-tradition standard played straight and executed to the craft of mymind, Apple Music/Podcasts, Readwise Reader and Things 3. It refuses the dashboard (counts, charts, feeds) and refuses novelty theming; polish lives in spacing, type, artwork and one living moment: the bloom.

OWN-WORLD: Warm off-white ground, near-black text, one orange accent that means only "new since last time" and "bloomed". A real text serif for item titles and reading; a workhorse sans for labels and metadata, small caps-style type labels with line icons. Soft-cornered cards with hairline edges and no shadows beyond a whisper; artwork always above text, never text over art. Ideas are fine-line botanical plant drawings at five stages; the bloom is the only colour in the drawing.

STORY: Tarik opens his phone after a walk and in one glance sees what Earmark caught — new tips with the names of who gave them, ideas that grew or bloomed — then taps into a bloomed idea to read its one-pager, or marks a tip tried. He believes it because every name, date and quote on screen is real.

FIRST VIEWPORT: Phone 390 wide. Earmark wordmark in the serif with tagline "Small moments. A bigger mind." and a small sprout mark; a full-width rounded search field "Search what you heard…"; the "New since last time" label with an orange dot and a horizontal row of compact chips (type icon, title, "from Ann · place"; blooms as "Bloomed · 3 mentions"); below, the start of the garden zone with the newest bloomed plant card. Bottom tab bar Home · Garden · Shelf · People.

FORM: Category standard (canon card), chosen by Tarik from generated mockups; not on the grounded ordered list. Seed key 07cc2c15.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

Signature interaction: the live bloom — the plant redraws from its current stage to bloom in place (stroke draw, then the single orange flower opens), a "Bloomed" chip slides into the New row, and an aria-live announcement fires. Reduced motion: final state, no animation. Motion grammar elsewhere: quiet 150–220 ms fades and lifts only.

Critique reference (code-led): .impeccable/mocks/decision/canon.png, .impeccable/mocks/idea-detail.png, .impeccable/mocks/rec-cards.png (local-only; artwork in them is invented — the build uses real artwork from enrichment).
