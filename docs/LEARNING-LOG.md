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
