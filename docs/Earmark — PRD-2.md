# Earmark — Product Requirements Document

Oct 15, 2026 · @Tarik Moody

## Overview and problem

Earmark is an eve agent that listens through a Bee wearable and keeps two things people lose every day: the half-formed ideas they say out loud, and the recommendations other people give them. Target submission: the Bee track of the Build, Ship, Shape: Amazon Developer Hackathon, due Oct 23, 2026 at 12:00 pm PT.

**One-line pitch:** Your Bee already hears your best ideas and your friends' best tips. Earmark makes sure neither disappears.

**The two problems**

- **Ideas evaporate.** Creators and builders think out loud on walks, in hallways and on calls. The same idea comes up three or four times over weeks, but nobody notices the pattern, so it never becomes a pitch, a segment or a spec.
- **Recommendations vanish.** "You have to try that ramen place" or "listen to this album" gets said in passing. Days later you remember neither the thing nor who told you, and the chance to follow up or say thanks is gone.

**What Earmark does about it**

- An **idea compost** that clusters spoken ideas over time and drafts a one-page pitch when an idea comes up for the third time. This is the lead feature.
- A **recommendation inbox** that catches tips by voice, photo or ambient capture, enriches them (what it is, where to get it, who said it) and queues them. Music recs land in an **Earmarked playlist in Apple Music** automatically.
- **Two-way with the Bee app**: enriched recommendations appear as Bee todos and confirmed tastes and ideas as Bee facts, so the user sees them in the Bee app and Bee's own assistant can use them. Checking a todo off in Bee marks the rec as tried in Earmark.
- A **light social layer**: rec receipts that tell the recommender you tried their tip, and a private taste ledger of whose tips you love.
- One hero surface, the **garden** web view, organized without effort (Smart Spaces, Serendipity, Top of Mind, memory-cue search, automatic links), with the Bee app, Notion, a **weekly audio episode** and **wrist reminders** as extensions of it.

## Goals, non-goals and success metrics

The hackathon goal is a working, demoable loop on real Bee data by Oct 23; the product goal is a personal tool worth wearing every day.

**Goals**

1. Turn real Bee conversations into two structured streams, ideas and recommendations, with no manual entry.
2. Surface a recurring idea as a ready-to-use one-page draft at its third mention.
3. Enrich every recommendation with what it is, where to get it and who gave it.
4. Deliver results where the user already is: Notion, a web view, a podcast app and the watch.
5. Score well on all four judging criteria: tech implementation, design, potential impact and quality of the idea.

**Non-goals for v1**

- Letting other people sign in with their own Bee (the rules say no public-facing integration is required).
- A social network, public profiles or feeds. v1 social features are private or one-to-one, sent only by the user.
- Writing to calendars, email or task managers beyond Bee todos and Apple Music playlists.
- Playing music, Apple Music previews or any copyrighted audio in the episode or demo video.
- Native mobile app. The web view is responsive instead.

**Success metrics (targets, to be measured with eve evals and a week of real use)**

| Metric | Target |
| --- | --- |
| Recommendation detection precision on a labeled sample of transcripts | 85% or better |
| Idea detection precision | 75% or better |
| Recommendations enriched with a valid external match | 80% or better |
| Time from Bee conversation summary to item in Notion (relay path) | Under 2 minutes |
| Weekly episode generated without manual fixes | 4 of 4 Sundays |
| Items the user dismisses as "not an idea / not a rec" | Under 20% |

## Users and user stories

The primary user is a creator-builder who talks for a living and thinks out loud: a radio host, newsletter writer, podcaster or product builder. Tarik is user zero.

| Persona | Context | What they need from Earmark |
| --- | --- | --- |
| Host / producer | Interviews, on-air banter, show prep calls | Segment ideas that keep coming up; music and guest tips from listeners and colleagues |
| Newsletter writer | Conversations with sources and peers | Pitches built from ideas mentioned across weeks, with the original context |
| Builder / PM | Hallway chats, walks, standups | Product ideas tracked to the point they are worth a spec |
| Food and culture enthusiast | Dinners, recordings, social events | Restaurant, book and album tips with who to thank |

**User stories (P0 unless marked)**

- As a creator, I want ideas I say out loud captured without opening an app, so I stop losing them.
- As a creator, I want to know when I keep returning to the same idea, so I can act on it.
- As a creator, I want a one-page draft built from every time I mentioned the idea, so I start from something, not nothing.
- As a listener of advice, I want every recommendation saved with who gave it and what it is, so I can find it later.
- As a music lover, I want recommended albums and songs added to an Apple Music playlist on their own, so I can just press play.
- As a friend, I want to send the recommender a short note once I have tried their tip, so the loop closes. (P1)
- As a friend, I want to see whose recommendations I tend to love, so I know whose tips to try first. (P1)
- As a Bee user, I want Bee to learn my tastes from what I tried and liked, after I confirm them. (P1)
- As a busy person, I want a short weekly audio recap I can play on a walk, so I review without a screen. (P1)
- As a user, I want to approve or dismiss uncertain items quickly, so the system stays trustworthy.
- As a user, I want everything mirrored in Notion, so it fits how I already organize my work.

## Product experience

The user does nothing new: they wear Bee and talk. Earmark works in the background, shows up first in the garden, and reaches out through Apple Music, the watch, Notion and a weekly episode.

**End-to-end flow**

1. **Capture, three ways.**
   - **Ambient:** Bee records conversations as usual.
   - **"Earmark that":** the user taps Bee and says what to keep ("Earmark that, Ann's ramen spot"). Bee streams the voice note as it is transcribed, so the item lands in seconds with the right person attached.
   - **Photo:** the user shares a photo (album cover, book, menu, flyer, screenshot) to Earmark from the phone's share sheet. Earmark links it to the Bee conversation happening at that time and place. Songs work the same way: one press of a Shazam Shortcut identifies what is playing and sends it in.
2. **Triage.** Jev classifies short windows of the live utterance stream and of finished conversations. Bee labels speakers generically, so attribution comes from the voice trigger, second-person cues ("you have to try"), Bee's summary or a quick Slack question.
3. **Confirm when unsure.** Mid-confidence items go to Slack as an approve / edit / dismiss card.
4. **Idea lane.** The idea joins an existing cluster (Jev picks among the 5 nearest) or starts a new one. Stage moves from compost (1 mention) to sprouting (2) to ready (3+).
5. **Live bloom.** Because triage runs on the live stream, a third mention makes the plant bloom in the garden while the user is still talking. The agent then gathers every past mention and relevant Bee facts and writes a one-page draft: newsletter pitch, radio segment rundown or product brief.
6. **Recommendation lane.** The rec is typed, enriched from the matching API and saved with the recommender's first name and a short excerpt.
7. **Straight to Apple Music.** Album, song and artist recs are added to the user's Earmarked playlist.
8. **Location nudges.** When Bee reports a conversation location near a saved place recommendation, the agent creates a Bee todo due now, and the watch buzzes: "You're two blocks from the ramen spot Ann told you about."
9. **Tried it.** The user marks a rec tried and rates it loved / fine / not for me; the rating feeds the taste ledger.
10. **Rec receipt.** For a loved rec, the agent drafts a short note to the recommender as a shareable card; the user approves and sends it. Deferred receipts become Bee todo reminders.
11. **Learning loop.** When three or more loved recs share a pattern, the agent proposes a pending Bee fact for the user to confirm.
12. **Weekly episode.** Every Sunday the agent writes and voices a 5-7 minute recap for a private podcast feed and can play it on an Echo through the Alexa+ MCP server.

**Surfaces**

| Surface | What the user sees | What the user can do |
| --- | --- | --- |
| Garden web view (hero) | Ideas as plants that grow with each mention; recs on a shelf with covers, recommender tags and a taste ledger | Tap a bloom to read its draft; mark recs tried and rate them; send rec receipts; connect Apple Music |
| Apple Music | An Earmarked playlist that fills itself | Play it anywhere, including on the watch |
| Watch (via Bee todos) | Thank-you reminders at a chosen time | Complete or snooze from the wrist |
| Rec receipt card | A short web card the recommender opens from a text; no account or Bee needed | Read it; the recommender does nothing else in v1 |
| Notion | Ideas and Recommendations databases with board views by stage and type | Edit, mark tried, dismiss; changes sync back to the agent |
| Weekly episode | Segments: What's growing, Ready to harvest, New in the crate, Don't forget, Thank-yous owed | Listen in any podcast app |
| Slack | Approval cards for uncertain items and proposed Bee facts | Approve, edit or dismiss in one tap |

### In the Bee app: two-way enrichment

Earmark writes its enriched results back into Bee through the two writable parts of the Bee API, todos and facts ([Bee API](https://docs.bee.computer/docs/api)), so the same items show in the Earmark garden and in the Bee app. Conversations and journals are read-only, so nothing is written there.

| What Earmark writes | Bee object | Example as it appears in Bee | What flows back |
| --- | --- | --- | --- |
| A queued recommendation | Todo, no alarm | "Earmark · Listen: Promises, Floating Points (Ann, Oct 12) music.apple.com/..." | Checking it off in Bee (`todo-updated`, completed) marks the rec tried in Earmark and opens the rating prompt |
| A place rec near the user | Todo, alarm now | "Earmark · You're near the ramen spot Ann recommended" | Same as above |
| A deferred thank-you | Todo, alarm at a chosen time | "Earmark · Thank Ann for the ramen tip" | Completing it marks the receipt sent |
| A confirmed taste | Fact | "Loves Japanese jazz" | Confirming or deleting it in Bee is mirrored in Earmark |
| A ready idea | Fact | "Developing a newsletter idea on AI in public radio (mentioned 4 times since Sep)" | Lets Bee's own assistant and Daily Insights draw on it |

**Rules so the Bee app stays clean**

- Only recommendations the user queued become todos, never every capture; at most 10 open Earmark todos at once.
- Every Earmark item starts with "Earmark ·" so it is recognizable and filterable.
- Facts describe only the user, never the recommender or anyone else, and stay pending until the user confirms.
- Bee items are text only, so covers and rich cards stay in the garden; each Bee item carries one link back.
- Earmark stores the Bee todo and fact IDs, so edits and deletions sync in both directions without duplicates.

**Stretch, if Bee grants access:** the Bee API's Threads endpoints post messages with image attachments into the user's chats with the Bee agent, which would allow a weekly visual Earmark card inside the Bee app. Threads are a preview for test users only and return 403 for other accounts, so ask about access at office hours.

### Organize nothing: ideas adapted from mymind

[mymind](https://mymind.com) promises "remember everything, organize nothing" for what people save and see. Earmark applies the same promise to what people hear and say: **mymind for the things you hear.** Like mymind, Earmark stays private by default; its only social feature is a one-to-one receipt the user chooses to send.

| Feature | Earmark version | Priority |
| --- | --- | --- |
| Smart Spaces | The user writes a space in one sentence ("This Bites episode ideas", "Rhythm Lab segment material", "Gift ideas"); Jev answers one yes/no question per space for every new item, and the space fills itself, including from past items | P1 |
| Type-aware cards | Each rec type has its own card on the shelf: square cover for albums, spine for books, mini map for places, tile for podcasts | P0 |
| Serendipity | A calm garden mode that shows one forgotten rec or stalled idea at a time: keep it, or let it return to compost (which also clears its Bee todo) | P1 |
| Top of Mind | Pinned ideas get a lower match threshold, an immediate flag on every new mention, and a pending Bee fact | P1 |
| Memory-cue search | Search by who, where and when ("the place Ann mentioned at dinner in September"), combining stored recommender, location and date with Bee neural search | P1 |
| Focus Mode | A bloomed idea opens in a clean writing view so the draft becomes the user's own | P2 |
| AI summaries | Context summaries and living idea timelines (below) | P0 |
| Linking | Automatic two-way links (below) | P1 |

**AI summaries: keep the why, not just the what.** Enrichment already supplies what an item is. The summary adds what only the conversation knows: the reason and the moment. A rec card reads "Ann: the broth is the reason to go; she went twice in October" rather than a restaurant blurb. An idea gets a **living timeline**, one line per mention, so the user sees how it grew ("Sep 12: newsletter angle · Oct 3: added a radio segment · Oct 15: named three possible guests"). Summaries are short, written by Claude via AI Gateway, embedded for search, and never quote more than the 25-word excerpt.

**Linking: automatic, because nobody links spoken notes by hand.** mymind lets users add links between notes as they work. Earmark builds the links itself and shows them as backlinks on every card, which the user can accept or remove:

- **Idea to idea:** related clusters, plus a merge suggestion when two ideas look like one.
- **Rec to idea:** a recommendation that fits an idea ("this album fits your segment idea") is cited in that idea's draft.
- **Person to items:** each recommender has a page of everything they suggested, which is also the taste ledger.
- **Item to moment:** every card links back to the Bee conversation, photo or song capture it came from.

Candidates come from embeddings; Jev decides which are real links (one yes/no question per candidate). In Notion, links are two-way relation properties. A graph view is out of scope for the hackathon; backlinks carry the feature.

**Added requirements**

| ID | Area | Requirement | Priority |
| --- | --- | --- | --- |
| FR-32 | Spaces | Create a Smart Space from one sentence; Jev evaluates every new and past item against it | P1 |
| FR-33 | Garden | Type-aware cards for each rec type | P0 |
| FR-34 | Garden | Serendipity mode: one forgotten item at a time, keep or compost; composting clears its Bee todo | P1 |
| FR-35 | Ideas | Top of Mind pins: lower match threshold, immediate flag on new mentions, pending Bee fact | P1 |
| FR-36 | Search | Memory-cue search by who, where and when plus Bee neural search | P1 |
| FR-37 | Summaries | Context summary on every rec card; living timeline on every idea | P0 |
| FR-38 | Linking | Automatic idea, rec, person and moment links with backlinks the user can accept or remove; Notion relations | P1 |

### Gardeners, email-in and publishing: ideas adapted from Fabric

**Gardeners (from [Fabric Agents](https://fabric.so/features/agents)).** Instead of fixed jobs, the user writes background agents in plain language, picks a schedule, scopes what each can read, and sets which actions need approval. eve's schedules and approvals already provide this. Examples:

- "Every Friday, turn my ready ideas into Intersection pitches."
- "On the 1st of each month, list the restaurant recs I haven't tried, for This Bites."
- "Each Sunday, find recs that fit my Rhythm Lab segment ideas."

The weekly episode becomes the first built-in gardener. Every gardener's output is a real draft in the garden and Notion; nothing is published or sent without approval.

**Email-in capture.** Earmark gets its own email address. Forwarding a friend's email or link adds it to the shelf with the sender as recommender. It is a capture channel that needs no app.

**Publishing (from [Fabric Publish](https://fabric.so/features/publish)).** Any Smart Space or bloomed idea can be published as a live page that updates as the space changes: "Heard at Radio Milwaukee this week" for listeners, "This Bites: recommended by our guests" as show notes, or one idea shared with a collaborator. Link-only by default; search indexing is opt-in; only approved items appear; recommenders are named only with their OK.

| ID | Area | Requirement | Priority |
| --- | --- | --- | --- |
| FR-39 | Gardeners | User-defined background agents: plain-language task, schedule, scoped sources, approval gates; output saved as drafts | P1 |
| FR-40 | Gardeners | Weekly episode re-implemented as the first built-in gardener | P1 |
| FR-41 | Capture | Email-in: an Earmark inbound address turns forwarded emails and links into recs with the sender as recommender | P1 |
| FR-42 | Publishing | Publish a Smart Space or idea as a live, link-only page; opt-in indexing; approved items only; recommender consent | P1 |

## Functional requirements

P0 items are required for the Oct 23 submission; P1 should ship if time allows; P2 is post-hackathon.

| ID | Area | Requirement | Priority |
| --- | --- | --- | --- |
| FR-01 | Ingest | Forward Bee events to the agent's HTTP channel with `bee stream --webhook-endpoint` (conversation, utterance, journal, todo and location events) | P0 |
| FR-02 | Ingest | Nightly schedule backfills conversations from the last 48 hours via the Bee conversations API, since the stream is at-most-once; dedupe by conversation ID | P0 |
| FR-03 | Triage | Classify each speaker-labeled window with Jev (Choice: idea\_by\_user, rec\_to\_user, rec\_by\_user, neither), plus rec type and a joke/hypothetical check; keep the calibrated confidence | P0 |
| FR-04 | Triage | Attribute speakers without relying on Bee's generic labels: voice trigger first, then second-person cues, Bee's summary, then a Slack question | P0 |
| FR-05 | Triage | Auto-accept above 0.85 confidence, send 0.5-0.85 to Slack for approve / edit / dismiss, drop below 0.5; tune thresholds on the labeled set | P0 |
| FR-06 | Capture | "Earmark that" voice capture: treat Bee voice notes (`journal-text` / `journal-created`) starting with the trigger phrase as explicit, high-confidence items | P0 |
| FR-07 | Capture | Live triage on a rolling window of `new-utterance` events so ideas can bloom during the conversation | P1 |
| FR-08 | Capture | Photo and song capture: an iOS share-sheet Shortcut posts an image, or a Shazam Recognize Music Shortcut posts title, artist and Apple Music link, with time and location, to the agent | P1 |
| FR-09 | Capture | Link each photo to the Bee conversation within 10 minutes and nearby location; read the image with a vision model and classify it with OpenAI Decisions (image input) | P1 |
| FR-10 | Ideas | Embed each idea, retrieve the 5 nearest clusters, and let Jev choose one of them or "new idea" | P0 |
| FR-11 | Ideas | Track mention count, first and last mention dates, and stage (compost, sprouting, ready, drafted, used, dismissed) | P0 |
| FR-12 | Ideas | At the third mention, run Bee neural search for related past conversations, read Bee facts, and write a one-page draft in the likely format | P0 |
| FR-13 | Recs | Type each rec (album, artist, song, book, place, podcast, film/TV, other) and enrich via the matching API | P0 |
| FR-14 | Recs | Save recommender first name, conversation date and an excerpt of 25 words or fewer | P0 |
| FR-15 | Music | Match album, song and artist recs in the Apple Music catalog and add them to an Earmarked playlist via a Music User Token from MusicKit JS | P0 |
| FR-16 | Location | When an `update-location` event falls near a saved place rec, create a Bee todo due now as a nudge; at most one nudge per place per day | P1 |
| FR-17 | Bee write-back | Write each queued rec to Bee as a todo ("Earmark ·" prefix, enriched name, recommender, one link); cap at 10 open Earmark todos | P0 |
| FR-18 | Bee write-back | When an Earmark todo is completed in Bee (`todo-updated`), mark the rec tried and prompt for a rating; mirror deletions | P0 |
| FR-19 | Bee write-back | Write confirmed tastes and ready ideas to Bee as facts about the user only; keep them pending until confirmed; mirror confirmations and deletions | P1 |
| FR-20 | Bee write-back | Keep a `bee_sync` map of Earmark items to Bee todo and fact IDs so edits never create duplicates | P0 |
| FR-21 | Bee write-back | If Threads access is granted, post a weekly visual Earmark card into a Bee chat thread | P2 |
| FR-22 | Social | Mark a rec tried (in the garden or by checking the Bee todo) and rate it loved / fine / not for me | P0 |
| FR-23 | Social | Taste ledger: per-recommender counts of recs given, tried and loved, shown only to the user | P1 |
| FR-24 | Social | Rec receipt: draft a note for a loved rec, render it as a shareable card at an unguessable URL, send only after user approval; deferred receipts become Bee todos | P1 |
| FR-25 | Notion | Create and update rows in Ideas and Recommendations databases; poll for user edits and sync them back | P0 |
| FR-26 | Garden | Responsive hero view: ideas by stage with live bloom, recs by type, taste ledger | P0 |
| FR-27 | Episode | Sunday script with five segments, voiced with Amazon Polly, stored in Vercel Blob, private RSS feed; play on an Echo through the Alexa+ MCP entry | P1 |
| FR-28 | Open source | Submit a bee-cli pull request fixing `--recent-days` / `--since` being ignored for facts and todos (issue #14); publish the eve Bee connection and triage skill as an MIT-licensed package | P0 |
| FR-29 | Quality | eve evals over 30+ labeled snippets on both Jev and OpenAI Decisions with shuffled options; show measured accuracy and calibration in the video | P0 |
| FR-30 | Privacy | Delete any item, excerpt or photo everywhere (store, Notion, garden, receipts, Bee todos and facts) with one command | P0 |
| FR-31 | Social | Station or team crates: a shared page of recommendations from several opted-in Bee users | P2 |

## System architecture

Earmark is one eve agent on Vercel, fed by a small local relay, writing to one Postgres store that every surface reads from.

&#91;embedded content: Earmark architecture · ingest, two lanes, one store, five surfaces, loop back into Bee\]

Bee data enters in real time through the relay or nightly through the backfill schedule; both lanes write to the same store. The loop also runs back into Bee: confirmed taste facts and reminder todos are written to the Bee API.

**eve agent folder**

```
earmark/
  agent.ts
  instructions.md
  skills/
    detect-idea.md
    detect-recommendation.md
    draft-one-pager.md
    draft-rec-receipt.md
    propose-fact.md
    episode-script.md
  tools/
    bee-conversations.ts   # list, get, neural search
    bee-facts.ts           # read facts; write confirmed proposals
    bee-todos.ts           # reminders with alarm_at
    cluster-ideas.ts
    apple-music.ts         # catalog match + add to Earmarked playlist
    enrich-book.ts
    enrich-place.ts
    enrich-podcast.ts
    enrich-film.ts
    taste-ledger.ts
    rec-receipt.ts         # render card, mint share URL
    notion-sync.ts
    synthesize-episode.ts  # Amazon Polly
  schedules/
    nightly-backfill.ts
    notion-poll.ts
    fact-proposals.ts      # weekly pattern check
    weekly-episode.ts      # Sunday morning
  channels/
    http.ts                # relay ingest
    slack.ts               # approvals
relay/
  run.sh                   # bee stream --webhook-endpoint (one command)
web/
  garden/                  # Next.js hero view + MusicKit JS sign-in
  r/[token]/               # public rec receipt cards
```

**Runtime notes**

- The relay is one command on the user's Mac, where the Bee CLI is logged in: `bee stream --webhook-endpoint` POSTs conversation, utterance, journal and location events to the agent ([Bee realtime docs](https://docs.bee.computer/docs/realtime)). Delivery is at-most-once, so the nightly backfill stays.
- Bee labels speakers generically (`speaker_1`, `Unknown`), so attribution is an Earmark job, not a Bee field (see FR-04).
- eve's sandbox runs enrichment and audio steps; its durable sessions retry failed API calls.
- Folder conventions follow eve's published layout (tools, skills, schedules, channels); confirm exact names against eve's docs at setup.

### Triage design: Jev decides, an LLM writes, code acts

Triage uses a decision model, not a chat model, because its calibrated confidence maps directly onto the auto-accept / Slack / drop thresholds. Jev is the primary model; OpenAI's Decisions API is the benchmarked alternative, one Gateway id away.

|  | Jev (TypeSafe AI) | OpenAI Decisions (gpt-6-luna) |
| --- | --- | --- |
| Role in Earmark | Primary for text triage | Benchmark and fallback for text; primary for photos |
| Gateway id | `typesafe-ai/jev` via AI SDK `experimental_evaluate` | `openai/gpt-6-luna-decisions` |
| Input price | $0.042 per 1M tokens, output free | $0.10 per 1M tokens, output free |
| Inputs | Text only | Text and images |
| Context | Small; send short windows only | About 1.05M tokens |
| Status | Early access; open on Vercel AI Gateway | Public beta since Oct 6, 2026 |
| Why | Native to eve and the Gateway; eve's `autoModel` already uses it | Handles images; larger model may catch subtle, indirect recs |

**Pipeline**

1. **Code** splits each Bee conversation into windows of a few speaker-labeled utterances.
2. **Jev** answers, in one call per window:
   - `kind` (Choice): idea\_by\_user, rec\_to\_user, rec\_by\_user, neither. `rec_by_user` keeps Tarik's own on-air and everyday recommendations out of the inbox.
   - `rec_type` (Choice): album, song, artist, book, place, podcast, film\_tv, other, none.
   - `joking` (Noul): is the suggestion clearly a joke or a hypothetical?
3. **Jev for clustering:** embeddings find the 5 nearest idea clusters; Jev picks one or "new idea" (Choice). This replaces a hand-tuned similarity threshold.
4. **An LLM** (Claude via AI Gateway) runs only on windows that pass: canonical item name, excerpt, one-pager and receipt drafts.
5. **Code** applies thresholds. Starting points: above 0.85 auto-accept, 0.5-0.85 to Slack, below 0.5 drop; tuned on the labeled set.

**Rules from Jev's published failure modes ([Jev 1.13 jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13))**

- Write exact conditions and boundary cases into each option's criteria; Jev reads literally.
- Keep windows short; unrelated text in the input lowers accuracy.
- Shuffle Choice options in evals; Jev can lean toward the first option.
- Never ask Jev to generate text, count or compare dates; that is the LLM's or code's job.

### Photo pipeline

Bee has no camera, so photos come from the phone; Earmark's job is to tie them back to the Bee conversation they belong to.

1. **Share.** An iOS share-sheet Shortcut ("Earmark this") sends the image plus its capture time and location to the agent's HTTP channel.
2. **Read.** A vision model (Claude via AI Gateway) lists what is in the image: titles, names, artist, restaurant, any visible text.
3. **Decide.** OpenAI Decisions, which accepts images, answers the same triage questions as Jev: is this a recommendation, what type, is it a joke or irrelevant.
4. **Link.** Code finds the Bee conversation within 10 minutes and nearby; Jev picks which of its windows the photo belongs to, which supplies the recommender's name and context.
5. **Store.** The item joins the recommendation lane. The image itself is kept only as a small thumbnail of the item, or not at all; photos of people are never stored.

### Song capture (Shazam)

Bee does not keep audio, so song recognition happens on the phone, then joins the same pipeline as photos.

1. **Recognize.** An "Earmark this song" Shortcut starts with the built-in Shazam **Recognize Music** action. It can run from the Action button, Back Tap, Siri or a Home Screen icon ([Apple Support](https://support.apple.com/en-gu/guide/shazam/deve5143aaf5/web)).
2. **Send.** The Shortcut posts title, artist, Apple Music link, time and location to the agent. No microphone audio leaves the phone.
3. **Link.** Code matches the song to the Bee conversation at that time and place, so "the song playing at dinner when Ann said I'd love it" keeps its context and recommender.
4. **Act.** The song joins the recommendation lane, goes into the Earmarked playlist and becomes a Bee todo like any other music rec.

**Later, native:** a small iOS companion app built with ShazamKit can recognize songs in-app; matched items include an Apple Music ID and Apple Music URL ([ShazamKit](https://developer.apple.com/documentation/shazamkit/shmediaitem.md)). Apple asks apps that display Shazam catalog matches to link to the song in Apple Music, which Earmark already does. The Shortcut path needs no app review, so it is the hackathon version.

### Earmark MCP server and integrations

The most impactful integration is Earmark itself as a small MCP server, shown through Alexa+ on an Echo. One server makes Earmark reachable from every assistant: Alexa+, Claude, ChatGPT and agents that already use the Bee Skill.

- **Tools:** `what_did_they_recommend(person, period)`, `ready_ideas()`, `search_earmarks(who, where, when, query)`, `add_to_earmarked_playlist(item)`.
- **Demo:** "Alexa, what did Ann tell me to try this month?" and "Alexa, play my Earmarked playlist." About 10 seconds of the video.
- **Why:** cross-device orchestration (Bee + Echo + Fire TV) leads the judges' list of creative Bee ideas; it adds a developer-experience angle; it reuses the Alexa+ MCP plumbing already in progress.
- **Guardrail:** keep the server small and Earmark-specific so the separate Alexa+ entry stays substantially different.

**Integration ranking**

| Rank | Integration | Status | Why |
| --- | --- | --- | --- |
| 1 | Earmark MCP server via Alexa+ | New | Cross-device, Amazon ecosystem, reaches every assistant |
| 2 | Apple Music | Planned | Daily value: recs become a playlist |
| 3 | Publishing (live pages) | New | Audience beyond the user: station crates and show notes |
| 4 | Notion | Planned | System of record |
| 5 | Newsletter platform drafts | Later | Bloomed idea straight into The Intersection; confirm the platform has a draft API |
| Skip | Calendar, Spotify, Goodreads | — | Bee Actions already covers email and calendar; others add surface, not points |

| ID | Area | Requirement | Priority |
| --- | --- | --- | --- |
| FR-43 | MCP | Earmark MCP server (Streamable HTTP) with the four tools above, read-only except playlist adds | P1 |
| FR-44 | MCP | Alexa+ demo: query recommendations and play the Earmarked playlist on an Echo | P1 |

## Data model

Postgres (Neon, with pgvector) is the agent's source of truth; Notion mirrors the user-facing fields.

**Postgres tables**

| Table | Key fields |
| --- | --- |
| `idea_clusters` | id, title, summary, timeline (json: date + one line per mention), centroid (vector), stage, pinned (Top of Mind), mention\_count, first\_mentioned\_at, last\_mentioned\_at, draft\_md, draft\_format, bee\_fact\_id, notion\_page\_id |
| `idea_mentions` | id, cluster\_id, bee\_conversation\_id, excerpt (25 words max), embedding (vector), spoken\_at, confidence, source (ambient, voice, photo, song) |
| `recommendations` | id, type, raw\_text, canonical\_name, creator, year\_or\_address, image\_url, links (json), context\_summary, apple\_music\_id, added\_to\_playlist\_at, recommender\_id, excerpt, bee\_conversation\_id, bee\_todo\_id, said\_at, lat, lng, source (ambient, voice, photo, song), status (new, queued, tried, thanked, dismissed, composted), rating (loved, fine, not\_for\_me), last\_surfaced\_at, confidence, notion\_page\_id |
| `photos` | id, recommendation\_id, taken\_at, lat, lng, linked\_bee\_conversation\_id, thumbnail\_url (optional), deleted\_at |
| `spaces` | id, name, rule\_sentence, created\_at |
| `space_items` | space\_id, item\_type, item\_id, confidence |
| `links` | from\_type, from\_id, to\_type, to\_id, kind (related, fits, merge\_suggestion, source), confidence, status (suggested, accepted, removed) |
| `recommenders` | id, first\_name, recs\_given, recs\_tried, recs\_loved (taste ledger counts) |
| `rec_receipts` | id, recommendation\_id, message, share\_token, approved\_at, sent\_via (text, link), bee\_todo\_id, alarm\_at |
| `fact_proposals` | id, text, kind (taste, idea), evidence\_ids (json), status (pending, confirmed, rejected), bee\_fact\_id |
| `bee_sync` | entity\_type, entity\_id, bee\_object (todo, fact), bee\_id, last\_synced\_at |
| `music_auth` | user\_token (encrypted), playlist\_id, updated\_at |
| `episodes` | id, week\_of, script\_md, audio\_url, duration\_sec, published\_at |
| `processed_conversations` | bee\_conversation\_id, processed\_at, idea\_count, rec\_count |

**Notion: Ideas database**

| Property | Type |
| --- | --- |
| Idea | Title |
| Stage | Select: Compost, Sprouting, Ready, Drafted, Used, Dismissed |
| Mentions | Number |
| First mentioned / Last mentioned | Date |
| Format | Select: Newsletter pitch, Radio segment, Product brief |
| Draft | Page body |

**Notion: Recommendations database**

| Property | Type |
| --- | --- |
| Name | Title |
| Type | Select: Album, Artist, Song, Book, Place, Podcast, Film/TV, Other |
| Recommended by | Text (first name) |
| Said on | Date |
| Status | Select: New, Queued, Tried, Thanked, Dismissed |
| Rating | Select: Loved, Fine, Not for me |
| In Apple Music | Checkbox |
| Link | URL |
| Cover | Files / URL |
| Excerpt | Text |

## Third-party APIs and integrations

Every integration fits in free tiers for the build week; expected spend is $0-10, mostly model calls.

**Core platform**

| Job | Service | Auth | Notes |
| --- | --- | --- | --- |
| Capture + learning loop | [Bee API / CLI](https://docs.bee.computer/docs) | Bee developer token | Read conversations, facts, journals, search; write todos and facts (the only writable objects). Use the public endpoint api.developer.bee.amazon.dev, which has a public TLS certificate; the private-CA host is only for raw TLS ([docs](https://docs.bee.computer/docs/proxy)) |
| Agent runtime | [Vercel eve](https://flaviocopes.com/vercel-eve/) | Vercel account | Runs only on Vercel Functions for now |
| Triage decisions | [Jev](https://github.com/kraayenjon/awesome-jev) via Vercel AI Gateway (`typesafe-ai/jev`) | Vercel account | $0.042 per 1M input tokens, output free; benchmark against [OpenAI Decisions](https://developers.openai.com/api/docs/guides/decisions) (`openai/gpt-6-luna-decisions`, $0.10 per 1M input) |
| Writing + embeddings | Vercel AI Gateway (Claude for drafts) | Vercel account | Runs only on windows that pass triage |
| Music match + playlist | Apple Music API + MusicKit JS; Shazam via the Shortcuts Recognize Music action | Developer token (MusicKit key from the Apple Developer account) + Music User Token from the user's sign-in | Catalog search server-side; playlist writes need the user token |
| Store | Neon Postgres + pgvector | Connection string | Free tier |
| System of record | Notion API | Internal integration token | Use the API, not the hosted MCP: its OAuth flow is built for interactive clients ([Notion MCP](https://developers.notion.com/guides/mcp/overview)) |
| Approvals | Slack API via eve's Slack channel | Slack app |  |
| Voice | [Amazon Polly](https://aws.amazon.com/polly/pricing/) | AWS IAM | Generative voices $30 per 1M characters; 100K characters/month free for 12 months, about 18 episodes |
| Audio + receipts hosting | Vercel Blob, Next.js on Vercel | Vercel account | MP3s, RSS XML, receipt cards |

**Enrichment by recommendation type**

| Type | Primary | Backup / extras |
| --- | --- | --- |
| Album, artist, song | Apple Music API (catalog search, artwork, Apple Music link) | MusicBrainz + Cover Art Archive (no key; about 1 request/second), Discogs (free token), Last.fm for tags |
| Book | Open Library (no key) | Google Books API (free key) |
| Place | Google Places API (New), field-masked to Essentials/Pro ([pricing](https://www.woosmap.com/blog/google-places-api-pricing)) | Foursquare Places |
| Podcast | Podcast Index (free key + secret, no approval) | Apple Podcasts search |
| Film / TV | TMDB (free key) |  |
| Context | Wikipedia / Wikidata (no key) |  |

**Excluded: Spotify.** Its 2026 changes cut endpoints for Development Mode apps and require a Premium account to develop ([Spotify](https://developer.spotify.com/blog/2026-02-06-update-on-developer-access-and-platform-security)). Apple Music's API covers the same need with better catalog data and library actions. Reuse existing Crate tools for music lookups where possible.

## Privacy, consent and safety

Earmark records other people's words, so it stores the minimum needed to be useful and keeps everything private to the user.

- **Minimal storage.** Keep the user's ideas and a short excerpt (25 words or fewer) per recommendation. Never store full transcripts outside Bee.
- **First names only** for recommenders. No contact details, no profiles, no inferred facts about other people. The taste ledger is visible only to the user.
- **Receipts are the user's messages.** Earmark drafts; the user approves and sends from their own phone. Receipt cards contain no excerpt of the original conversation, only the user's note and the item.
- **Unguessable links.** Receipt cards and the RSS feed sit behind random tokens and are not indexed.
- **Facts need consent.** Proposed Bee facts stay pending until the user confirms; nothing is written to Bee about anyone else.
- **Apple Music token.** The Music User Token is stored encrypted, used only for the Earmarked playlist, and revocable by signing out.
- **Consent practice.** The README and demo state that people on camera and in recordings agreed to be recorded. Tell guests and co-hosts when Bee is on.
- **Delete everywhere.** One action removes an item and its excerpt from Postgres, Notion, the garden and any receipt (FR-28).
- **Human in the loop.** Uncertain items need approval; the agent never sends messages to other people on its own.
- **Secrets.** Bee token, Notion token, Apple MusicKit key, AWS keys and Slack credentials live in Vercel environment variables, never in the repo.
- **Episode content.** Describe albums and songs; never include music, previews or other copyrighted audio, per the contest rules.

## Hackathon compliance and judging fit

Earmark enters the Bee track and two mini-challenges, AWS Builder and Open Source ([rules](https://amazonappdev2026.devpost.com/rules)).

**Hard requirements**

- [ ] Uses data recorded by an actual Bee device or Apple Watch running Bee, shown live in the demo video
- [ ] Bee API imported and called at runtime in the code, not just named in the README
- [ ] GitHub repo, public with an open-source license visible in the About section, or private and shared with the Amazon reviewers
- [ ] Clear setup and run instructions in the repo
- [ ] Demo video under 3 minutes on YouTube or Vimeo, no copyrighted music
- [ ] Text description of features
- [ ] Product feedback for each tool used (Bee, eve, Polly)
- [ ] Friction log entries (worth up to a 10% bonus)
- [ ] Submitted before Oct 23, 2026, 12:00 pm PT

**Judging criteria mapping (equally weighted)**

| Criterion | How Earmark scores | What could cost points |
| --- | --- | --- |
| Tech implementation | Real-time Bee stream plus backfill; conversations, neural search, facts (read and write) and todos all used; eve tools, skills, schedules, channels, approvals and evals; Apple Music library writes | Looking like Bee is only a transcript source. Fix: show facts written back and todos on the watch |
| Design | Zero new user behavior; one hero surface (garden) with clear extensions | Surface sprawl in a 3-minute video. Fix: tell the story through the garden; show the rest in seconds |
| Potential impact | Universal problem, sharpest for creators; receipts and station crates reach people beyond the user | "Why not Bee's own todos?" Fix: say it plainly: Bee captures moments, Earmark finds patterns across weeks and finishes the work |
| Quality of the idea | The third-mention compost is novel; hits the judges' named examples: ambient capture feeding a productivity workflow, advanced facts use, real time, self-improvement; Apple Music and Echo add cross-device | The rec inbox alone is near the obvious end. Fix: lead with the compost |

**Mini-challenges**

- **AWS Builder:** Amazon Polly called at runtime for every episode; document it in product feedback.
- **Open Source:** two contributions. (1) A bee-cli pull request fixing `--recent-days` / `--since` being ignored for facts and todos ([issue #14](https://github.com/bee-computer/bee-cli/issues/14)), matching the judges' example of a bug fix that unblocks other developers. (2) The eve Bee connection and triage skill as an MIT-licensed package.
- **Friction log:** entries for generic speaker labels, the private CA certificate, at-most-once stream delivery, the `--recent-days` bug and Developer Mode as a distribution barrier. Raise the speaker question at office hours on Monday, Oct 19, 11:00 am CT.

## Risks and mitigations

Speaker attribution is the biggest unknown; test it on day one with real recordings.

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Bee labels speakers generically (speaker\_1, Unknown), confirmed in Bee's docs | Recs credited to the wrong person; ideas mixed with others' words | "Earmark that" voice capture names the person; otherwise second-person cues, Bee's summary, then a Slack question |
| Not enough real history for the "third mention" moment | The core demo beat is staged | Start wearing Bee on Oct 15 and repeat chosen ideas on purpose across days |
| Vercel Functions cannot hold the SSE stream open | No real-time ingest | `bee stream --webhook-endpoint` posts events to the agent; nightly backfill catches misses |
| Bee API pagination errors on deep history ([issue](https://github.com/bee-computer/bee-cli/issues/14)) | Failed calls, missing data | Use targeted list and search calls, never `bee sync`; fix the client-side part upstream |
| Earmark todos and facts clutter the Bee app | The user turns write-back off | Only queued recs become todos; 10 open at most; "Earmark ·" prefix; facts only after confirmation |
| Two-way sync loops or duplicates | Repeated or ghost items in Bee | `bee_sync` ID map; ignore `todo-updated` events Earmark itself caused |
| eve is in public preview | Breaking changes or missing features | Pin the version; keep tools as plain TypeScript functions that run outside eve too |
| Jev reads literally and can favor the first Choice option | Misclassified windows | Exact criteria per option; shuffle options in evals; short windows only |
| Both decision models are new (Jev in early access, OpenAI Decisions in beta) | Rate limits, API changes or outages | Keep the triage call behind one function; switch Gateway ids if one fails |
| Apple Music user token setup or expiry | Playlist adds fail silently | Sign in once on the garden; check the token on each run and flag in Slack when it needs renewing |
| Wrong Apple Music or enrichment match | The wrong album, book or restaurant shown | Add only above a match-confidence threshold; otherwise ask in Slack; let the user fix it in Notion |
| Too many surfaces | Product reads as scattered | Garden is the hero; the Bee app is the second surface; others get seconds in the video |
| Scope creep in 8 days | Unfinished P0s | Photos, location nudges, episode, receipts, ledger and fact proposals are P1; cut the garden to a list view if behind on Oct 20 |

## Delivery plan

The build follows bumwad's five phases across eight days, with all P0 work done by Oct 21 and the last two days kept for docs, the video and buffer.

&#91;embedded content: Delivery plan · bumwad phases, Oct 15–23\]

The gate on Oct 20, 2026: if the idea and recommendation lanes are not writing to Notion by then, cut the garden to a list view and move the episode to post-submission. Submit by the morning of Oct 23, 2026 to leave a buffer before the 12:00 pm PT cutoff.

**Research (Oct 15-16)**

- [ ] Wear Bee all day starting now; plant repeat ideas and recommendations on purpose
- [ ] Bee developer mode, CLI login, `bee stream --webhook-endpoint` to a local eve dev server
- [ ] Build "Earmark that" voice capture first; it fixes attribution
- [ ] Ask colleagues if two or three will wear Bee for a few days

**Concept (Oct 16-17)**

- [ ] Write `detect-idea.md` and `detect-recommendation.md` skills, including exact option criteria for Jev
- [ ] Create Postgres schema and Notion databases
- [ ] Label 30+ transcript snippets for evals
- [ ] Benchmark Jev vs OpenAI Decisions on the labeled set; pick the triage model and starting thresholds

**Design development (Oct 17-19)**

- [ ] Idea clustering, live bloom on the utterance stream, third-mention draft
- [ ] Recommendation typing and enrichment tools
- [ ] Apple Music: MusicKit key, developer token, catalog match, Earmarked playlist writes
- [ ] Notion sync and Slack approval cards
- [ ] bee-cli pull request for issue #14; attend office hours Monday, Oct 19; small Earmark MCP server
- [ ] Deploy agent to Vercel; nightly backfill schedule live

**Refinement (Oct 20-21)**

- [ ] Garden web view with MusicKit JS sign-in, live bloom and taste ledger
- [ ] Photo and song capture: share-sheet and Shazam Shortcuts, vision read, OpenAI Decisions, conversation linking
- [ ] Location nudges from `update-location` events
- [ ] Tried / rated flow, rec receipt cards and Bee fact proposals
- [ ] Gardeners with the weekly episode as the first (script, Polly, Blob, RSS, Echo playback); email-in capture; publish a Space as a live page; Alexa+ demo through the Earmark MCP server
- [ ] Type-aware cards, context summaries, Smart Spaces, Serendipity, Top of Mind pins and automatic links; run evals and tune thresholds

**Construction docs (Oct 22-23)**

- [ ] Collect a week of real-use numbers; publish the newsletter issue or air the segment that started as a bloomed idea
- [ ] README with setup and run steps; license; open-source package
- [ ] Product feedback for Bee, eve, Jev, OpenAI Decisions and Polly; friction log entries
- [ ] Record and upload the demo video
- [ ] Submit on Devpost

## Demo video script

The video runs 2:45 and shows real Bee data at every beat.

| Time | Beat | On screen |
| --- | --- | --- |
| 0:00-0:15 | The problem | Tarik on a walk: "I've said this idea three times and never written it down." |
| 0:15-0:45 | Live bloom (lead) | Tarik says the newsletter idea a third time; the garden plant blooms while he is still talking; the one-page draft opens with dates of all three mentions |
| 0:45-1:05 | "Earmark that" | Ann recommends a ramen spot; Tarik taps Bee: "Earmark that, Ann's ramen spot." It lands on the shelf in seconds with her name and the address |
| 1:05-1:20 | Photo | Tarik photographs an album a friend holds up and shares it; it joins the shelf linked to that conversation and appears in the Earmarked playlist (no audio played). A song playing nearby is identified with one press and lands in the same place |
| 1:20-1:35 | Location nudge | Days later near the restaurant, the watch buzzes: "You're two blocks from the ramen spot Ann told you about" |
| 1:35-1:55 | Closing the loop | Rec marked loved; receipt card sent to Ann; taste ledger ticks up; a proposed Bee fact is confirmed |
| 1:55-2:15 | Under the hood | eve folder, the Bee webhook, Jev vs OpenAI Decisions accuracy on the labeled set, the bee-cli pull request; a Smart Space typed as one sentence fills itself from a week of conversations |
| 2:15-2:35 | It already works | A week of real numbers, and the Intersection issue or Rhythm Lab segment that started as a bloomed idea; the Sunday episode playing on an Echo |
| 2:35-2:45 | Close | Station crate mock-up; "Wear Bee. Talk. Earmark keeps what matters." |

## Open questions and roadmap

**Open questions**

- [ ] Final name: Earmark, Overheard or Hearsay?
- [ ] Exact trigger phrase for voice capture, and whether Bee's voice notes can be told apart from other journal entries reliably
- [ ] Does `POST /v1/facts` create facts as pending, so the user confirms them in the Bee app, or does Earmark hold proposals until confirmed?
- [ ] The Bee API also forwards a `photos` endpoint: could photos taken in the Bee app replace or complement the share-sheet Shortcut?
- [ ] Threads access for the weekly visual card (ask at office hours)
- [ ] Photos: keep a thumbnail of the item, or discard every image after reading it?
- [ ] Which Polly generative voice, and one host or two?
- [ ] Rec receipt delivery: SMS share sheet, copied link, or both?
- [ ] Should the garden live under a Radio Milwaukee subdomain or a personal domain?
- [ ] Does Echo playback blur the line with the separate Alexa+ entry?

**Roadmap after the hackathon**

- Station crates: Radio Milwaukee hosts opt in, and a public "Heard at Radio Milwaukee" page shows the week's staff recommendations with Apple Music links.
- Team mode: ideas clustered across several people's meetings, matching the judges' "synced insights across teams" example.
- Two-way receipts: recommenders who also use Earmark see when their tips land.
- Akili sync: write drafts and recs into the personal knowledge system as markdown.
- Notion MCP once headless OAuth is practical.
- More rec types: events, articles, products.
- Monthly "idea retrospective" episode on what moved from compost to used.

**Sources**

- [Build, Ship, Shape: Official Rules](https://amazonappdev2026.devpost.com/rules), [Updates](https://amazonappdev2026.devpost.com/updates) and [Resources](https://amazonappdev2026.devpost.com/resources)
- [Bee CLI getting started](https://docs.bee.computer/docs), [Realtime Sync](https://docs.bee.computer/docs/realtime), [Agentic Now](https://docs.bee.computer/docs/agentic-now) and [API / proxy](https://docs.bee.computer/docs/proxy)
- [bee-cli issue #14](https://github.com/bee-computer/bee-cli/issues/14)
- [Vercel eve overview](https://flaviocopes.com/vercel-eve/) and [The New Stack on eve](https://thenewstack.io/vercel-launches-eve-an-open-source-framework-that-treats-agents-as-directories/)
- [awesome-jev: Jev pricing, access and SDKs](https://github.com/kraayenjon/awesome-jev) and [Jev 1.13 jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13)
- [OpenAI Decisions API guide](https://developers.openai.com/api/docs/guides/decisions)
- [Amazon Polly pricing](https://aws.amazon.com/polly/pricing/)
- [Notion MCP overview](https://developers.notion.com/guides/mcp/overview)
- [Spotify developer access update](https://developer.spotify.com/blog/2026-02-06-update-on-developer-access-and-platform-security)
- [Google Places API pricing 2026](https://www.woosmap.com/blog/google-places-api-pricing)
