# 007 — "Earmark that" works anywhere in a conversation, not only in a voice note

**Decision:** Saying "Earmark that…" at the start of a sentence inside an ordinary Bee conversation is treated as a deliberate earmark, exactly like a voice note: always kept, never sent to the review pile. Bee's mishearing "Remark that" counts as the trigger too.

**Why this came up:** The first time Tarik tried it for real (2026-10-16, conversation 11333494), he said "Earmark that…" four times in the middle of a normal conversation, not in a voice note. His Bee account has no voice notes at all. Until then the trigger only worked in voice notes, so those four would have gone through the "listen in the background and guess" path (ambient triage: a model, Jev, reads short slices of the conversation and decides what looks like a tip). That path usually cannot tell who gave a tip and files uncertain items for review, so a request he made on purpose would have been treated as a maybe. Getting it wrong means the one thing he explicitly asked us to save arrives uncredited and in a queue.

**Options:**
1. **Keep the trigger voice-note only** and tell Tarik to always press-and-hold. Cost: it does not match how people talk; the first real use already broke it.
2. **Treat the trigger as deliberate anywhere, once Bee closes the conversation** (chosen). Cost: it lands a few minutes after the conversation ends, not instantly.
3. **Also act on it live, while the conversation is still being recorded.** Cost: the live path and the after-the-fact pass could each save the same item, so we would need a second layer of duplicate handling, for a gain of a few minutes. Voice notes already give the fast path.

**What we chose and why:** Option 2 — Tarik's call (2026-10-16), with Claude shaping the rules. One shared matcher (a small pattern that recognises the trigger) now serves both voice notes and finished conversations, so the two cannot drift apart. In a finished conversation, each triggered sentence is pulled out *before* the background pass runs: if the sentence is a full one (ends with a full stop or similar, six words or more) it stands alone, otherwise the next two things said are added (stopping at the next trigger). The pulled-out text goes through the same extraction, name-checking and saving steps as a voice note, and is removed from what the background pass reads, so the same thing can never be saved twice. Each earmark is stamped with its sentence's id inside the conversation, with a database rule (a unique index: a lookup structure that refuses duplicates) behind it, so processing a conversation again after a hiccup still gives exactly one item per earmark. Names follow the existing rule: first names only, the garden owner is never credited, and a group like "the syntax guys" is kept in the excerpt but never credited as a person. We also stopped the extractor crediting a possessive name that is the item's own artist ("Jemetta Rose's new albums" is not a tip from Jemetta).

**What we gave up:** Someone else in the room saying "Remark that…" at the start of a sentence now becomes a deliberate earmark, kept for sure with no review. Live mid-conversation earmarks wait for the conversation to close (minutes); voice notes are the fast path (seconds). Misheard names inside the earmark ("Sun Raw" for "Sun Ra") are saved as heard; fixing them is later work.

**How we'll know if this was right:** After a week of real use, count how many deliberate earmarks Tarik dismisses as "I didn't mean that" (a stray "remark that" in conversation), and check that no earmark he spoke mid-conversation is missing from his list. If strays are more than a rare event, require the trigger to be followed by a recognisable item, or drop "Remark that".

**What actually happened:**

