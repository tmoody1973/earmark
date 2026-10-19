# Gardeners: what they are and how to use them

A gardener is a small helper you set up once by describing a job in one sentence. On the schedule you pick, it reads
the parts of Earmark you allow, writes you a draft, and leaves it on the Gardeners page for you to approve or dismiss.

Think of it as a standing assignment for an intern: "Every Friday, look through these folders and leave me a memo
about X." The intern sees only the folders you hand over, and never sends anything on your behalf.

## How one run works

1. **It wakes up** at the time you chose (weekly on a day, or monthly on a date, at an hour in Central time), or when
   you tap **Run now**.
2. **It reads only what you ticked** under "It may read":

   | Box | What it sees | Limit |
   |---|---|---|
   | **Ideas** | Each idea's title, its stage (compost, sprouting, ready, drafted, used), how many times you've mentioned it, and its format if you picked one | Your 30 most recent ideas |
   | **Recommendations** | Each tip's name, type, creator, status (new, to try, tried, thanked), your rating, the friend's first name, and the date | Your 60 most recent tips, leaving out dismissed tips, composted tips and the Maybe pile |
   | **Who recommended what** | Each friend's first name and how many tips they gave, how many you tried and how many you loved | Your 30 most generous friends |

   It never sees your conversations, transcripts or quotes, and it doesn't browse the web.
3. **It writes a draft** following your sentence.
4. **A safety check reads the draft** before you see it. It rejects a draft that invents people, uses a last name,
   names you, or quotes more than 25 words. A rejected draft gets one rewrite; if that fails too, you get nothing
   rather than something wrong.
5. **The draft waits under Drafts.** **Approve** keeps it and **Dismiss** clears it. Neither sends anything anywhere.

## Writing a good job sentence

A good sentence names **what to look at, what to produce, and how long**. For example:

- Weak: "Help me with my ideas."
- Strong: "From my sprouting and ready ideas, write three 2-sentence pitches for The Intersection, best first."

Tips:
- **Say the format.** "A 5-item list", "three short paragraphs", "a table with name, friend, why".
- **Say the size.** "Top 3", "under 150 words". Short drafts get read.
- **Tick only the boxes the job needs.** A pitch job needs Ideas; a thank-you job needs Recommendations and Who
  recommended what.
- **Expect honesty.** If nothing fits, the gardener says so and explains why. It never makes things up.

---

## Examples

### 1. Friday pitch desk (Ideas)

> **Job:** "Turn my sprouting and ready ideas into up to three Intersection pitches, each a headline and two sentences.
> If nothing is ready, tell me which ideas are closest and what would move them forward."
> **When:** Weekly, Friday, 9. **Reads:** Ideas.

**Case study (Oct 18, real run).** All 56 of Tarik's ideas were still at compost, and none had been mentioned twice. So
the gardener wrote no pitches. It explained why, then grouped related ideas into three themes worth promoting: Doom and
Battleworld, WandaVision and Agatha, and two takes on Kingpin as Spider-Man's villain. It ended with a next step: move
one theme out of compost and pick a format. **Lesson:** an empty week still produces a useful memo, because the job
sentence said what to do when nothing is ready.

### 2. Weekend listening list (Recommendations)

> **Job:** "Pick five music tips I haven't tried yet, from as many different friends as possible. For each: the name,
> who recommended it, and one line on why it might fit this weekend."
> **When:** Weekly, Friday, 16. **Reads:** Recommendations.

**What you get:** a short list you can act on Saturday morning. It mixes friends, so one person's taste doesn't
dominate. **Why it works:** the tips' status tells the gardener what you haven't tried, and the friend's name comes
with each tip.

### 3. Thank-you tracker (Recommendations + Who recommended what)

> **Job:** "List the tips I rated 'loved' but haven't thanked anyone for yet, grouped by friend, oldest first. Add a
> one-line thank-you idea for each friend."
> **When:** Monthly, day 1, 10. **Reads:** Recommendations, Who recommended what.

**What you get:** a monthly nudge to close the loop with people whose taste paid off. **Then:** open the tip on the
Shelf and use **Thank \<name\>** to draft and share the real note. The gardener only reminds you; it never sends.

### 4. Radio segment prep (Ideas + Recommendations)

> **Job:** "From my ideas and my place and food tips, suggest three segment angles for This Bites, each with a working
> title, the tips it would draw on, and a question to ask on air."
> **When:** Weekly, Monday, 8. **Reads:** Ideas, Recommendations.

**What you get:** a Monday-morning starting point built from what you actually heard that week, not from a blank page.
**Watch for:** if your recent tips are mostly music, the angles will lean that way. The gardener works with what's there.

### 5. Whose taste matches mine (Who recommended what)

> **Job:** "Once a month, tell me which three friends' tips I love most often, with the numbers, and one sentence on
> what that suggests about whose recommendations to act on first."
> **When:** Monthly, day 15, 18. **Reads:** Who recommended what.

**What you get:** a small taste report. A friend with 6 tips given and 4 loved is a better bet than one with 12 given
and 1 loved. **Why it works:** the counts are exact, and the gardener can't invent them.

### 6. Shelf clean-out (Recommendations)

> **Job:** "List tips that have been waiting more than two months without being tried. Sort them into 'still worth it'
> and 'probably let go', with one reason each."
> **When:** Monthly, day 1, 9. **Reads:** Recommendations.

**What you get:** permission to let old tips go. **Then:** you do the clearing yourself, from the Shelf ("…" →
Dismiss). The gardener suggests; it never changes your data.

---

## What a gardener can't do

- **It can't read conversations.** It sees the summary fields in the table above, never what was said.
- **It can't send, post or change anything.** Every draft stays on the Gardeners page until you act on it.
- **It can't see beyond its limits:** the latest 30 ideas, 60 tips and 30 friends.
- **It can't use last names**, name you, or quote more than 25 words.
- **The weekly episode** is a special built-in gardener that also turns its script into audio. It stays paused until
  the audio service (AWS Polly) is set up.
