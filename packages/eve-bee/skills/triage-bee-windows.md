---
description: Use when triaging Bee wearable transcripts for recommendations or ideas with eve-bee's triageWindow, or when choosing what to do with its probabilities.
license: MIT
---

# Triage Bee windows

Use `triageWindow(text)` from `eve-bee` on a **short window**: about 4 consecutive utterances (step 2, so windows overlap),
formatted as `Speaker: text` lines. Bee labels every speaker `Unknown`, so never infer who spoke from the label.

One `experimental_decide` call (AI SDK 7) asks independent questions about the same window:
- `kind`: `neither`, `idea_by_user`, `rec_to_user`, `rec_by_user` (criteria in `KIND_CRITERIA`)
- `rec_type`: album, song, artist, book, place, podcast, film_tv, video, other, none (criteria in `REC_TYPE_CRITERIA`)
- `joking`: is the suggestion clearly a joke or sarcasm?
- `broadcast`: is the audio an ad, a radio/podcast/TV broadcast, an online video, an audiobook or song lyrics?
- `correction` (only with `{ correction: true }`, for deliberate voice captures): does the speaker correct a tip saved earlier?

Route in code, never by asking the model. Drop the window when:
- `kind` is `neither`, or `rec_by_user` (the user recommending to an audience is not a tip for them)
- `broadcastProbability` is above 0.5, or missing (fail closed); skip this check for deliberate voice captures
- `jokingProbability` is above 0.5

Then route by `kindProbability`, the probability of the chosen kind:
- above 0.9: accept
- 0.6 to 0.9: ask the user
- below 0.6, or `NaN` (no probabilities came back): drop

Those numbers were tuned for Jev on a small labeled set. Re-tune them on your own labels, and again whenever you change
the model: Jev and OpenAI Decisions are not calibrated against each other.

Rules from Jev's published failure modes (jev-1.13):
- Write exact conditions and boundary cases into each option's criteria; Jev reads literally.
- Keep windows short; unrelated text lowers accuracy.
- Shuffle Choice options in evals (`optionOrder: "shuffled"`), with non-numeric keys; Jev leans toward the first option.
  That is why `neither` is listed first in production: a lean toward dropping protects precision.
- Never ask Jev to generate text, count, or compare dates. Use code or a writing model.

When the whole call fails (gateway down, bad key), keep the conversation for a later retry instead of recording
"nothing found". `SystemicTriageError` is the error to throw for that case.
