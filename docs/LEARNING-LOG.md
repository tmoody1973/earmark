# Learning log

Dated entries. Each answers: what did we expect, what happened, what do we now believe.

## 2026-10-16 · Bee speaker labels
- **Expected:** Bee would label speakers (`speaker_1`, `speaker_2`) so Earmark could tell Tarik's words from other people's.
- **What happened:** research found every utterance comes back as `"Unknown"` (bee-cli issue #19).
- **What we now believe:** attribution has to come from what people say ("Earmark that, Ann's …", "you have to try …"), not from Bee's labels. The voice trigger is the most important feature in M1.

## 2026-10-16 · Proving the secret scanner works
- **Expected:** the plan's AWS "EXAMPLE" sample key would make gitleaks refuse the commit.
- **What happened:** gitleaks 8.30.1 let it through ("no leaks found") and the commit went in, because it deliberately ignores keys that contain the word EXAMPLE. We undid that local commit and retried with a random fake GitHub token, which was blocked.
- **What we now believe:** a guard is only proven when you test it with something it is built to catch. Use a realistic-looking fake secret, not documentation placeholder text.

## 2026-10-16 · A crash between claim and save
- **Expected:** claiming a conversation first, then saving, would make each conversation process exactly once.
- **What happened:** the save is now one all-or-nothing transaction and a failure releases the claim, but a hard crash (process killed) between the claim and the save leaves a claim with zero counts that the backfill then skips.
- **What we now believe:** accepted limit for the hackathon. Recovery is to delete that row from `processed_conversations`; the next backfill reprocesses it.

## 2026-10-16 · The wearer gets addressed by name
- **Expected:** if a name appears in the conversation text next to a recommendation, it is a safe credit for who recommended it.
- **What happened:** after backfilling real conversations, 4 of 32 recommendations were credited to "Tarik", the garden's own owner. People say "Tarik, you have to try this", so his name appears in the text constantly, but he is the one being told, never the one telling.
- **What we now believe:** a name showing up in the text is not attribution. The owner's first name is now rejected as a recommender (`EARMARK_OWNER_FIRST_NAME`), and a one-off script un-credited the 4 saved rows. Known limit: only the exact first name is matched, so nicknames and aliases are not handled. More generally, test attribution rules against real recordings, not only invented examples.

## 2026-10-16 · The room's radio is not a recommender
- **Expected:** Jev would only turn up recommendations when people in the room were recommending things.
- **What happened:** Bee records everything audible, so podcast sponsor reads, radio spots and our own station ID filled the garden: most of 32 recommendations were ads. We added a broadcast question to the same Jev call and dropped windows above 0.5 before extraction. Re-running the backfill gave 18 recommendations. On the two hand-written test windows the model scored an ad read 0.98 broadcast and a person talking about an ad 0.03. One station ID ("88.9") still slipped through as a song.
- **What we now believe:** with an always-on recorder, "is this a person talking?" has to be asked before "is this a recommendation?". Fixing it in the prompt cuts most of the noise but not all of it; a real signal from Bee (a media-audio flag or speaker labels) would be better. Check real data after any such fix, because the hand-written tests pass either way.

## 2026-10-16 · Nobody repeats an idea in a week of talk
- **Expected:** a week of real Bee history (Oct 6–14) would already hold a few ideas mentioned two or three times, so the "bloom at the third mention" demo could come from past talk.
- **What happened:** after clustering, all 34–35 ideas had exactly one mention. The closest-looking pairs were all from the same conversation, and Jev judged each pair to be different ideas (0.88–1.0).
- **What we now believe:** the compost works, but a bloom has to be planted: the same idea said in three separate conversations on different days. The recording guide now says how.

## 2026-10-16 · Bee's change feed lists a conversation once
- **Expected:** asking Bee "what changed since my last bookmark?" every 10 minutes would list a conversation again when it finished, so Earmark could process it then.
- **What happened:** the feed listed conversation 11331219 once, when it started. It kept growing (218 → 220 lines) without being listed again.
- **What we now believe:** anything caught mid-recording needs its own waiting list (kept for up to 48 hours) or it waits for the nightly re-read. Test what an API actually does over time, not what its docs imply.

## 2026-10-16 · "Earmark that" said mid-conversation
- **Expected:** Tarik would use Bee's voice-note feature for deliberate earmarks, so the trigger only needed to work on voice notes.
- **What happened:** the first real try was four "Earmark that…" lines in an ordinary recorded conversation; the account had zero voice notes. Bee also misheard one as "Remark that".
- **What we now believe:** design for how the person actually talks. The trigger now works anywhere (including "Remark that"), and voice notes are the fast path rather than the only one.

## 2026-10-16 · Tests that fake an error's name
- **Expected:** tests that build an error with the name "APICallError" would prove Earmark retries during an AI outage.
- **What happened:** the AI library really names its errors "AI_APICallError". The check looked for the unprefixed name, so it would have missed every real outage, and the tests still passed because they used the same wrong name. A reviewer found it by reading the installed library.
- **What we now believe:** test with the library's real error classes and use its own type checks (`APICallError.isInstance`), never a lookalike name.

## 2026-10-16 · A misheard artist hid the right album
- **Expected:** searching MusicBrainz for the title AND the artist would find the album, and Jev would only need to rule out remixes and tributes.
- **What happened:** Bee heard "Salt" for the band SAULT. Requiring the artist returned three wrong albums; Jev correctly answered "none fits", so the tip stayed unmatched. Making the artist an optional, approximately-spelled hint brought back the right album, and Jev accepted it.
- **What we now believe:** search wide and let the judge be strict. The lookup should tolerate Bee's mishearings; the same-item check is where precision lives.
