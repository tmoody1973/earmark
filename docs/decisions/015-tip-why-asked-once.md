# 015: Each tip's "why" is written once, by the rec lane, and left blank when nobody gave a reason

**Decision:** The one-line "why" on a tip's card (FR-37) is written by the rec lane's 10-minute sweep. That is the same bounded job that looks tips up (decision 013), and it never runs while a page is loading. Each tip is asked about once. If the conversation gave no reason, the line stays empty. The same sweep then writes the tip's embedding (a list of numbers that lets Earmark find ideas that *mean* something similar). It uses the one recipe in `recEmbedText`.

**Why this came up:** PRODUCT.md's rule 2 is "keep the why, not just the what". The shelf card already had room for a quoted why line, but nothing filled it. The plan's draft wrote the filler line "No reason given; said in passing." when there was no reason, and it would have retried every tip whose why was empty on every run. There was a real risk of getting this wrong. The card could show invented or encyclopedia-style text, name Tarik on his own card, or keep paying for model calls on tips that will never have a reason.

**Options:**
1. **Filler text when there's no reason, and treat an empty why as "not done yet".** Cost: filler on the card reads like a fact. Tips with no reason get asked again forever, which costs one model call per tip per run.
2. **A `summarized_at` column marking "asked once", with an empty why allowed** (chosen). Cost: a small migration (013). A tip whose model call keeps failing is asked again each run.
3. **Write the why when the tip is saved, during the request.** Cost: a model call while saving a tip, which breaks the binding rule that model calls stay off the request path.

**What we chose and why:** Option 2. The controller set the rules (sweep only, null instead of filler, first names only, never the owner) and Claude built it:
- **Sources:** the 25-word excerpt and, when the tip came from a conversation, Bee's own summary of it, cut to 150 words. If Bee is down, the why is still written from the excerpt alone.
- **Guards in code, not just the prompt:** the line is cut to 25 words, the card's quote marks are stripped (the card adds its own), and a line that names the owner is dropped. The owner is never offered to the model as the recommender. The card already shows "from Ann", so the line doesn't start with the name.
- **Caps:** at most 10 why-lines per run, counted apart from Jev's 8. A run stops asking after 3 failures in a row. The embedding step makes one `embedMany` call per run, for at most 20 tips, with a 30-second timeout.
- **Re-embedding:** when the why, name or creator changes, the old embedding is cleared and the sweep writes a new one. The hourly links run (lane B) also fills in missing embeddings. It now writes one only if the tip's text hasn't changed since it read it, so a stale vector can't stick.
- **Tips that already had a why** (seeded or hand-written) count as done and are never overwritten.

**What we gave up:** A tip whose model call always fails costs one call per run until someone looks at it (there's no attempts counter). New tips show their why up to about 10 minutes late. Some tips will have no why at all, which is honest but sparser. The Wikipedia one-line context add-on is "what" text, so it is not part of the why. It stays a separate task (see the M3-T5 report).

**How we'll know if this was right:** After the backlog drains, count visible tips with a why vs. without one. Then read 10 whys against their excerpts: none should invent a fact, describe the item in general, or name Tarik. `summaryFailed` in the sweep logs should be near zero.

**What actually happened:**
