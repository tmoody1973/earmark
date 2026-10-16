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
