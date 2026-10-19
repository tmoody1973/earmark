# 054 — eve-bee: the Bee connection and the triage skill as an open-source package

**Decision:** The parts of Earmark that any Bee + eve builder could reuse now live in `packages/eve-bee/`, MIT licensed: the Bee REST client, the parser for live Bee events, the "Earmark that" trigger, the relay script, and the triage call with its criteria (`triageWindow`), plus an eve skill file describing how to route its answers. Earmark imports the package's source files by path, so there is one copy of that code. It is not published to npm yet.

**Why this came up:** FR-28 asks for the eve Bee connection and the triage skill as an open-source package (the hackathon's Open Source challenge). What was at stake: if the package were a second copy of the code, the two copies would drift and the published one would quietly stop matching what Earmark actually runs. And if it carried anything of Earmark's, real speech or the owner's data would go public.

**Options:**
1. **Copy the files into a package.** Cost: two copies of every file; a fix in one never reaches the other.
2. **Move the files into the package, and leave a one-line re-export at each old path in the app** (a re-export, a file whose only job is to say "the real code is over there"). Cost: the package's code has to stand alone, so the few settings it read from Earmark's config (the Bee token and address, the triage model) become plain options with defaults.
3. **Make the app depend on the package as an installed workspace dependency** (a pnpm workspace, the setup that lets one repo hold several packages that install each other). Cost: changes the lockfile and needed a registry download, which this task was not allowed to do; it also changes nothing about how the code runs.

**What we chose and why:** Option 2, decided by Claude from the plan (M6-T2), with these rulings where the plan, written on Oct 16, no longer matched the code:
- **Only the types the package needs moved.** `ItemKind`, `RecType` and `TriageResult` live in the package; Earmark's own types (tip statuses like `overheard`, ratings, idea stages) stay in the app, which re-exports the three. The plan moved the whole types file, which would have published Earmark's data model for no reason.
- **The relay stays where it is, and the package carries a copy.** The live relay on the VPS is deployed by copying `relay/run.sh` and `relay/forward.ts`; moving them would break that path. CI now compares the two copies (and the LICENSE) and fails if they differ.
- **The skill file is only in the package, not in Earmark's `agent/skills/`.** eve lists every skill in that folder in the agent's instructions, so adding it would change what Earmark's agent sees. The brief asked for the app's behaviour to stay identical.
- **The package's source imports end in `.ts`.** Next's bundler would not map `./criteria.js` onto `criteria.ts` inside `packages/`; a `.ts` import names a file that really exists, so every tool finds it, and the package build rewrites them to `.js` in its output. Earmark's TypeScript settings gained `allowImportingTsExtensions` for this.
- **Real speech came out of the moved tests.** Four "Earmark that" test sentences were real voice notes, and two Bee search results held real details; they are now invented sentences that test the same things.

**What we gave up:**
- Not a workspace package: inside this repo, `pnpm --filter eve-bee` doesn't work; the commands are `pnpm --dir packages/eve-bee build` and `test`. The package declares no dev dependencies of its own; it borrows the repo's TypeScript and Vitest.
- The relay and the LICENSE are still two copies. CI catches a difference, but only after someone edits one of them.
- The Bee address and triage model defaults are written in two places (Earmark's env settings and the package). A unit test fails if they differ.
- The routing numbers (accept above 0.9, drop below 0.6) are only described in the skill file, not shipped as code, because they have to be re-tuned for each model.
- Not on npm: anyone who wants it today has to build it from the repo.

**How we'll know if this was right:** CI stays green with the drift check in place, and no change to the Bee client or triage lands in Earmark without the package getting it too (there is nowhere else to make it). The real test is publishing: `npm publish --dry-run` should list only `dist/`, `relay/`, `skills/`, `README.md`, `LICENSE` and `package.json`, and someone outside the project should be able to run the README's 20-line example against their own Bee.

**What actually happened:**
