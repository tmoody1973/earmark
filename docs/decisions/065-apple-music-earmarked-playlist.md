# 065 — Music tips land in an "Earmarked" playlist in Tarik's own Apple Music library

**Decision:** Tarik signs in to Apple Music once on a new owner-only page, `/music`, using Apple's own sign-in (MusicKit on the Web). Earmark keeps the sign-in encrypted and, on each pass of the background agent (every 10 minutes), adds matched song and album tips, and every song captured with Shazam, to a playlist called "Earmarked" in his library. Each tip goes in once. An album adds its first song. The tip's page then says "In your Earmarked playlist".

**Why this came up:** FR-15 in the original plan (task M3-T6): a recommendation is only useful if it is somewhere you will actually meet it again, and for music that place is the music app, not a web page. The Shazam capture (press the Action button while a song plays) already saved song tips with Apple's own song id; nothing moved them into the music app. Tarik approved the feature on Oct 21 as part of the proactive-agent plan, and the demo video ends a beat with a Shazam capture showing up in the playlist. If it goes wrong, the risks are real but small: a song added twice, a sign-in token leaked, or a dead sign-in that makes the agent pester Apple every 10 minutes.

**Options:**
1. **Apple's sign-in once, the agent adds tips on its own** (chosen). Cost: a Music User Token (Apple's long-lived pass to his library, about six months) has to be stored, so it is encrypted at rest with a key only the server has (`MUSIC_TOKEN_KEY`, AES-256-GCM, a cipher that also refuses a blob someone altered). It expires, so a reconnect path is needed.
2. **An "Add to Apple Music" button on each tip, no stored token.** Cost: nothing happens on its own, which is the opposite of the proactive agent; a Shazam capture would still need a second tap on a web page later.
3. **A shared playlist link Earmark keeps updated outside his library.** Cost: Apple offers no such public write API; it would mean scraping or a different service.

**What we chose and why:** Option 1. Tarik approved it on Oct 21 ("Needs from Tarik: one sign-in on /music"); Claude built it. Smaller calls inside it, made by Claude:
- **An album adds one song, its first track, not the whole album.** The playlist stays a list of tips (one row each) instead of being swamped by a 14-track album. Apple's catalog has no "most popular song of this album", so "first track" is the honest version of "top song". An artist tip adds its top song only when Tarik asks for it by voice (Alexa or the MCP server), never on its own: "check out Khruangbin" names no particular song.
- **No database change.** The table for the sign-in (`music_auth`) and the per-tip "added" timestamp (`added_to_playlist_at`) were created on day one. When Apple refuses the sign-in, the stored token is replaced with the word `revoked` (the dead token is useless anyway), which is how `/music` knows to say "Reconnect". A tip that keeps failing for another reason counts its tries in the tip's extras (a free-form JSON field) and stops after three.
- **Never twice.** A tip is marked added before Apple is asked, and the mark is taken back if Apple says no. Apple has no "remove from a library playlist", so a double add could not be undone.
- **Maybes wait.** A "maybe" tip (Earmark wasn't sure it was a recommendation) goes in once Tarik keeps it; cleared and overheard tips never do.
- **The sign-in is checked before it is saved:** finding or creating the playlist is its first use, so a token Apple refuses is never stored.

**What we gave up:** The token sits in our database (encrypted; the key lives only in Vercel). Albums are represented by one song, which may not be the one the friend meant. A tip Tarik later corrects to a different album keeps its first song in the playlist and the corrected one is not added (Apple can't remove songs, and re-adding was left out). When the sign-in expires, tips wait silently until he notices "Reconnect" on `/music`; there is no alert yet.

**How we'll know if this was right:** One real Shazam capture appears in "Earmarked" in the Music app within about 10 minutes (the Oct 21 real check, with a screenshot). Over the following weeks: the number of matched music tips with `added_to_playlist_at` set versus those without, and whether Tarik plays from the playlist at all. If he never opens it, the feature is decoration.

**What actually happened:**
