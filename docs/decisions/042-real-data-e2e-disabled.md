# 042 — Real-data e2e runs are disabled until they use a database role that cannot write

**Decision:** `E2E_REAL` no longer runs. `playwright.config.ts` stops at startup with "E2E_REAL is disabled: real-data runs need a read-only database role (see decision 042). Run e2e on the test branch." Every e2e run uses the Neon test branch.

**Why this came up:** A real-data run pointed the e2e dev server at production and set `GARDEN_READ_ONLY=1`. That flag only works where a function remembers to check it (`gardenReadOnly()`). The M4-T10 polish pass found several writes that never check it. Marking a tip tried or dismissed (`chooseTip`) doesn't, creating a Space doesn't, and neither do lane C's receipt and gardener actions. One click in a real-data test could therefore change Tarik's real garden. The safety lived in each piece of code, and any new action could quietly break it.

**Options:**
1. **Disable real-data runs now** (chosen). Cost: no screenshots or checks against real data until the database itself refuses writes. Design reviews use seeded test data, which looks less like real use.
2. **Add `gardenReadOnly()` to every action that writes.** Cost: it is the same per-action promise that already failed. The next new action can forget it, and nothing would catch that.
3. **Keep real-data runs, but only for specs that never click.** Cost: a page can still write while it renders, and "never clicks" is a rule people have to remember, not something enforced.

**What we chose and why:** Option 1 (the coordinator's ruling during M4-T10, built by Claude). A safety property should come from something that cannot be bypassed, and only the database can promise that. `gardenReadOnly()` stays where it is: it is harmless, and it makes a future read-only run quieter. **To turn real-data runs back on**, give `E2E_REAL` its own database connection that cannot write, used as the server's `DATABASE_URL`:
- a Neon role granted `SELECT` only on the production tables, or
- a connection string that opens every session read-only (`options=-c default_transaction_read_only=on`). A write then fails with an error instead of being silently skipped.

Then remove the throw in `playwright.config.ts` and point `E2E_REAL` runs at that connection string.

**What we gave up:** Real-data screenshots and checks, for now. Seeded test data misses odd real cases, such as very long names, missing artwork and unusual tip types. The test branch is also shared by every agent, so tests that count things can flake when someone else is writing to it at the same time.

**How we'll know if this was right:** No e2e run writes production. Once the read-only role exists, a real-data run that clicks a write action fails loudly with a database error, rather than passing because a no-op hid the write.

**What actually happened:**
