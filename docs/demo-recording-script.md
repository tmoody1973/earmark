# Demo recording script (Oct 21)

Lines to say, in order, for every beat of the video. Say them in your own words where marked: Earmark matches ideas by meaning, not exact wording. What matters is the **core** of each idea staying the same.

## Before you start

- Bee's press-and-hold set to **Voice Notes** (Bee app → Settings). A voice note lands in Earmark in seconds; a remark inside a conversation lands about 10 minutes after Bee closes that conversation.
- Rules that make every line work:
  1. **"Earmark that" comes first** in the sentence. Filler before it is fine ("Okay, earmark that…").
  2. **One thing per note.**
  3. **Say a first name** for a friend's tip. Your own name is never credited.
  4. **Name the actual thing** ("Kawa Ramen", not "that place").
- No music audible in any shot (contest rule). Shazam a song with headphones on, or film the phone screen only.

---

## 1. The bloom (the lead beat, 0:15–0:45)

**How bloom works:** mention 1 plants an idea (compost), mention 2 sprouts it, mention 3 blooms it. A bloom writes a one-page draft with the dates of all three mentions, then researches the idea and buzzes your wrist "draft and research ready" within about 10 minutes.

**Each mention must be a separate occasion:** a different voice note or a different conversation. Saying it three times in one conversation counts once.

**Plant two ideas** (A and B) so one is a backup. Same core every time, different words each time.

### Idea A: the 88Nine listener tip line

Core: *88Nine* + *a listener tip line* + *listeners send music and local tips, the station shares the best ones*.

| When | How | Say (adapt freely, keep the core) |
|---|---|---|
| **Round 1: now** | Voice note | "Earmark that — an idea for 88Nine: a listener tip line where people text us the songs and local spots they love, and we share the best ones on air." |
| **Round 2: at least an hour later** | A different voice note, **or** say it to a colleague in a real conversation | "Earmark this: the 88Nine tip line again — listeners leave a thirty-second voice tip about a band or a place, and we turn the best into a weekly segment." |
| **Round 3: on camera** | Voice note while the garden is on screen | "Earmark that — I keep coming back to the 88Nine tip line: listeners sending us their tips, and the station thanking them on air when we use one." |

In conversation (round 2), these openers are caught best: *"What if 88Nine had…"*, *"An idea for a segment…"*, *"We could do a…"*.

### Idea B (backup): The Intersection on AI and archives

Core: *The Intersection newsletter* + *public radio stations using AI on their archives*.

| When | How | Say |
|---|---|---|
| Round 1 | Voice note | "Earmark that — newsletter idea for The Intersection: how public radio stations are using AI to open up their archives." |
| Round 2 | Different voice note or conversation | "Earmark this: The Intersection piece on AI and station archives — which stations are doing it well, and what it costs them." |
| Round 3 | On camera, voice note | "Earmark that — The Intersection should cover public radio putting AI on its archives; I've now said this three times." |

### After each round

Tell Claude "round 1 done" (then "round 2 done"). Claude checks the idea moved up (planted → sprouting) using counts only, never reading what you said. **Don't record round 3 until round 2 is confirmed as sprouting.**

### On camera (round 3)

1. Garden open on the laptop (https://earmark-two.vercel.app/garden), screen recorder running, phone camera on you.
2. Say round 3 as a voice note.
3. Within seconds the plant blooms; tap it to open the one-page draft with the three dates.
4. Optional second take about 10 minutes later: your wrist buzzes "'<idea>' bloomed: draft and research ready"; open the research brief.

---

## 2. "Earmark that": a friend's tip (0:45–1:05)

Say it right after a friend recommends something (use their real first name, with their OK to appear in the video):

- Place: "Earmark that, **[name]**'s ramen spot — **Kawa Ramen** on Murray Avenue."
- Album: "Earmark that, **[name]** says listen to **Sault**'s **Acts of Faith**."
- Film or TV: "Earmark that, **[name]** says watch **Shōgun** on Hulu."
- Book: "Earmark that, **[name]** recommends **Range** by David Epstein."

On screen: the tip lands on the Shelf with the name, the cover or map, and a Bee to-do. For a place, the tip page shows "The place" with hours.

## 3. Shazam into Apple Music (1:05–1:20)

1. A song is playing (headphones on, or film only the phone).
2. Press the Action button ("Earmark this song" Shortcut).
3. On screen: the song tip on the Shelf, then, after the next pass (about 10 minutes), the song in the **Earmarked** playlist in the Music app.

A friend's album tip from beat 2 also lands in Earmarked by itself.

## 4. The agent works on its own (cut-ins, any time)

Film these as they happen. Each is real and needs no setup beyond the line.

| What to say | What to film |
|---|---|
| "Earmark that, **[name]**'s favorite bar — **Diaspora** in Riverwest." (a place the map doesn't know) | The tip page: the web-found pin at 735 E. Center St., then "The place" with hours and "Details from <site>". |
| A tip Earmark isn't sure about, e.g. "Earmark that, **[name]** says try **Kawa Ramen**." (two locations) | Your Bee app: "Is this Kawa Ramen & Sushi? Confirm in Earmark"; tap through and pick one; the reminder ticks off. |
| "Earmark that, **[name]** says see **[an artist touring the Midwest]** live." | The tip page's "Playing nearby" with a date, venue and source link, and the Bee reminder for the day before. |

## 5. Closing the loop (1:35–1:55)

- Mark a tip **Loved** and open the thank-you card for the friend.
- Show a Bee fact Earmark proposed, confirmed in the Bee app.

## 6. Under the hood (1:55–2:15)

- The `agent/` folder in the editor, the live relay log, the Oct 19 eval numbers (Jev 66.7% accuracy), the bee-cli pull request.
- One sentence over it: "When Earmark hears something, it keeps working on it, and only checks in when it needs me."

---

**Not yet checked on real data:** a repeat idea joining its earlier mention (never seen in production yet; that is why round 2 gets confirmed before round 3), shows nearby on a real tour page, and the bloom's research buzz.
