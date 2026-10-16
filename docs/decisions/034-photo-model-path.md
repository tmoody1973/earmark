# 034 — Photos are judged through the AI Gateway, and the full image goes to the model vendors

**Decision:** Earmark's photo feature asks OpenAI's "Decisions" model (a model that answers yes/no and pick-one questions and reports how sure it is, as a probability) about each photo through the same AI Gateway (the single proxy Earmark already sends its model calls through). It does not use a separate direct OpenAI connection. A second model, Claude, reads the title and creator printed in the photo.

**Why this came up:** The Gateway's model list suggested the Decisions model might accept text only, while its description says it takes text and images. If the Gateway quietly dropped the image, every photo would be judged blind and come back with a confident but meaningless answer, and nothing would visibly break. The photo feature's gating (is there something to save? is a person in frame?) depends on those probabilities being real.

**Options:**
1. **Assume the Gateway passes images and build on it.** Cheapest, but a silent failure would look like a working feature. Ruled out.
2. **Test it once with a real image, then pick the path.** Costs a few cents and a small script (`scripts/probe-photo-decisions.ts`); tells us the truth before we build.
3. **Go direct to OpenAI from the start.** Certain to forward images, but adds a second vendor package, a second secret (an API key) to store and rotate, and a second bill, for a problem that may not exist.

**What we chose and why:** Option 2 (Claude, per Tarik's plan). On 2026-10-16 the probe sent a public book cover (Fantastic Mr Fox, no person in it) and asked "does the image show the cover of a book?". Result: `{"model":"openai/gpt-6-luna-decisions","p":1,"warnings":[]}`. A probability of 1 with no warnings means the Gateway did forward the image, so we kept the single-vendor Gateway path and added no new package or key. A live end-to-end check on the same cover then returned: item found 1.0, type book, person in frame 0.0, and a title read of "FANTASTIC MR. FOX" by "ROALD DAHL". The settings `PHOTO_DECISION_PROVIDER` (default `gateway`) and an empty `OPENAI_API_KEY` slot exist in the config so the direct route can be added later without redesign, but no code uses them yet.

**Privacy note:** the full photo is sent to the model vendors (OpenAI for the yes/no questions, Anthropic for reading text) via the Gateway. Earmark does not store the image, and its logs record ids and error names only, never the image or what the model said.

**What we gave up:**
- **One probe on one easy image is not proof for every photo.** A clear book cover passing says the image path works, not that blurry or oddly lit shots are classified well.
- **Dependence on the Gateway's behaviour.** If it later stops forwarding images, nothing in the code would notice; the numbers would just get worse.
- **The photo is read by two vendors**, so two companies see each image instead of one.
- **A leftover warning:** the Claude read uses an image part type the AI SDK now labels deprecated; it works and logs a notice, and will need a one-line swap later.

**How we'll know if this was right:** Re-running `scripts/probe-photo-decisions.ts` still gives p above 0.8 with no warnings, and in the first week of real photos, covers and signs score as items while landscapes and pets do not. If photos of obvious items keep scoring near 0.5, suspect the image is not arriving and revisit the direct OpenAI route.

**What actually happened:**
