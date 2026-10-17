# bee-cli PR for issue #14 — Open Source mini-challenge

- **Contribution URL:** https://github.com/bee-computer/bee-cli/pull/22
- **Project repo:** https://github.com/tmoody1973/earmark
- **GitHub username:** tmoody1973
- **Upstream issue:** bee-computer/bee-cli#14 (client half; the server-side 500s need an API change)
- **Branch / commits:** `fix/sync-recent-days-facts-todos` on tmoody1973/bee-cli — 1ee3cba (fix + tests), 6ace901 (README)
- **Opened:** 2026-10-16, approved by Tarik before opening

## Devpost description (short)

`bee sync --recent-days` and `--since` now apply to facts and todos, not just daily summaries and conversations. The CLI filters each newest-first page by `created_at` and stops paging once a page ends before the cutoff — so a bounded sync never walks into the deep `/v1/facts` pages that return 500 for the account in #14. Five new tests; on a real account a full sync wrote 21 facts, `--recent-days 3` wrote 9.

## PR body (as opened)

This is the CLI half of #14. Refs #14.

`bee sync --recent-days N` and `--since` limit daily summaries and conversations, but facts and todos are always downloaded in full: every page, every run. The README says that's on purpose, since they're usually small. For the account in #14 it's what breaks sync: `/v1/facts` returns a 500 partway through the history, and no flag lets you avoid it.

I found #14 while building a hackathon project on top of Bee's data.

This change makes both flags apply to facts and todos too:

- The facts and todos list endpoints have no date filter, so the CLI filters each page by `created_at`.
- Lists come back newest first, so once a page ends before the cutoff, the CLI stops asking for more. With `--recent-days 7` it never reaches the old pages that fail.
- If a page isn't in newest-first order, it doesn't stop early. It keeps paging and filtering, so nothing in the window goes missing.
- `--since` takes the same values as before (epoch ms or a `v1-` cursor). For facts and todos it means "created since," because they don't go through the change feed.
- Without either flag, nothing changes.
- The README's sync section now says facts and todos follow both flags, instead of "always synced in full".

One behavior to flag: `facts.md` and `todos.md` are rewritten on every run, so passing either flag on a repeat sync leaves only the matching items in those two files. Daily summaries and conversations still ignore `--recent-days` on repeat syncs, as the README describes. I went this way because applying the flag only on first syncs would leave every repeat sync walking the full facts history into the same 500. Happy to change it if you'd rather keep them consistent.

The server-side 500s in #14 (`/v1/todos`, `/v1/daily`, and deep `/v1/facts` pages) aren't fixed here. Those need an API change.

### Testing

- 5 new tests in `sources/commands/sync/index.test.ts`: reading the cutoff from both flags, stopping after the first page older than `--recent-days`, `--since` on todos, pages that aren't newest first, and no flags at all. The first four fail on `main`.
- `bun run typecheck`, `bun run build` and `bun test` (382 pass, 1 skip, 0 fail; `main` is 377 pass) are clean.
- On my own account: a full facts sync wrote 21 facts going back 10 days; `--recent-days 3` wrote 9, all from the last 3 days. Todos: 8 in full, 1 with `--recent-days 3`. My account fits in one page and doesn't hit the 500, so the early stop is covered by the unit tests, not a live run.

Built with Claude Code. The tests and live checks above ran on my machine, against my own Bee account.

## Friction noted along the way
- `gh 2.102` rejects `gh repo fork <repo> --clone --remote` (dropping `--remote` gives the same remotes).
- No 500s reproduced on Tarik's account today; the bee-cli issue #10 lockfile workaround wasn't needed.
