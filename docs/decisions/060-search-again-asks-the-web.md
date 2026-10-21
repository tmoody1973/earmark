# 060 — When the owner's search finds nothing, Earmark asks the web, and the agent keeps looking on its own

**Decision:** "Search again" on a tip's "Which one?" asks the tip type's catalog (for a place, OpenStreetMap) first, and when that finds nothing it asks the web with the owner's words. Separately, when the owner's own search came up empty, the background agent no longer steps aside: it still runs its once-per-tip web find on the next pass.

**Why this came up:** On Oct 21, right after decision 059 shipped, Tarik typed "Diaspora bar milwaukee" into Search again and got "Nothing came up for that". The same words in the TinyFish playground found the bar at once (735 E. Center St.). Two gaps: Search again only ever asked the catalog, never the web; and any owner search, even an empty one, told the agent "the owner is handling this", so the agent's web find never ran either. Tarik's point: the power of an agent is that it looks before he has to.

**Options:**
1. **Web as Search again's fallback, and an empty owner search doesn't stop the agent** (chosen). Cost: a Search again that finds nothing on the map takes longer (one web search, one model call, a few map lookups: roughly 5 to 15 seconds) and costs a fraction of a cent.
2. **Always search the map and the web together.** Cost: every Search again pays for a web search and a model call, and mixes web guesses in with exact catalog hits.
3. **Leave Search again catalog-only; only the agent uses the web.** Cost: the owner's own words are never tried on the web, and the agent still waits on an owner who already gave up.

**What we chose and why:** Option 1. Tarik asked for it ("make this proactive with the agent so it searches before I do"); Claude built it. The catalog stays first because its hits are exact and carry details; the web only fills a blank. The agent's rule now reads: stay out of tips where the owner's search found options (they are choosing), but keep looking where it found nothing.

**What we gave up:** A slow Search again when nothing is on the map. The web answer is still only a "Which one?" option, so a wrong address costs a tap, not a wrong saved tip.

**How we'll know if this was right:** Count Search again calls that ended with web options versus nothing, and how often the owner picks a web option. If web options are picked less than a third of the time, the fallback is noise.

**What actually happened:**
