# Overheard noise: how ambient-capture products handle it, and what Earmark should do

Research date: 2026-10-19. Method: web search and reading primary sources (product help pages, reviews, papers). No Earmark production data or transcripts were opened for this; the numbers about Earmark come from the brief (51 person-less overheard tips, 42 cleared; 1 overheard tip with a named person, kept; 9 deliberate captures, 0 cleared).

Each finding is marked **Evidence** (a source says it) or **Inference** (my reasoning from the evidence).

---

## 1. Bottom line

1. The products that people trust log overheard things quietly and save only what the owner asked for. The products that get panned push overheard media at the owner as if it were theirs (Bee's to-dos from TV shows, Friend's running commentary, Apple's news summaries).
2. The research agrees: an assistant should act only when it is quite sure, ask when it is unsure, and do nothing otherwise. Wrong suggestions cost more trust than right ones earn. Showing the owner a mistake is only cheap when ignoring it costs nothing.
3. That supports **Option 1 with one change**: an overheard tip needs a person recommending it to the owner, and deliberate captures always save. But person-less overheard items are **not thrown away**. They go to a quiet "Heard nearby" log that has no badge and no count, and the owner can promote one with a single tap.
4. Option 2 (a "Maybe?" row capped at 3 a day) still asks the owner to judge mostly ads every day. Option 3 (tips from deliberate captures only) turns off the part of Earmark that is magic and still leaves the ad problem in ideas.
5. Tighten the broadcast filter regardless. Measure success by the cleared rate for overheard tips that reach the shelf or Maybe: from 82% now to 25% or less over the next 7 days, while the owner promotes fewer than 1 in 10 items from the quiet log.

---

## 2. How comparable products handle it

"Auto-saves" means it lands in the owner's main list with no question asked. "Asks first" means a confirm or dismiss step. "Logs quietly" means it is kept somewhere the owner can look, without interrupting them.

| Product | Auto-saves | Asks first | Logs quietly | Known complaints | Source |
|---|---|---|---|---|---|
| **Bee** (2025 Pioneer; Oct 2026 Frontier) | Transcripts and conversation summaries. An 8 PM daily diary-style summary (a digest). | **Suggested to-dos**: accept or reject each one. **Facts**: the reviewer called it "fact Tinder", swipe yes or no. | Full transcripts and history, searchable by chat. | Could not tell real conversation from TV, TikTok, music, podcasts. Abbott Elementary produced a to-do about a SEPTA strike; Kendrick Lamar lyrics became a person named "Kendra". 4 of 5 day-one to-dos were useless. The reviewer started muting it during TV. The CEO promised "liveness detection" for broadcasts. Speaker labels unreliable. A 2026 reviewer found it did recognise a movie night as a film. | [1] [2] [3] [4] [5] |
| **Bee + Alexa+ / Amazon.com** (Oct 2026) | n/a | n/a | Items you mention are surfaced as product suggestions on the Amazon homepage and in the Bee app. Alexa can "pull up the name of the book your friend suggested". | Too new for reviews. | [5] [6] |
| **Limitless Pendant** (acquired by Meta, discontinued) | Transcripts, notes, summaries. | Not confirmed. | Full recording history. | "Consent Mode" used voice ID to record only people who had agreed. Reviewers reported speaker mislabelling. | [7] |
| **Omi** | Summaries, tasks and "memories" from conversations. | Not confirmed for tasks. | An AI step **discards** low-value conversations. They are hidden, not deleted: a "Show Discarded Conversations" setting brings them back. Since 2026, clips under 30 seconds are dropped outright as "noise". | A reviewer said the home screen of goals and tasks got "really messy"; Omi then let users hide it. Reliability complaints. | [8] [9] [10] |
| **Friend pendant** | n/a | n/a | n/a. It **pushes** unsolicited commentary on what it overheard as text messages. | WIRED: "snarky and unhelpful", "a real bummer". | [11] |
| **Plaud NotePin S** | Only what you record. A long press starts and stops recording. | n/a | A short press marks a "highlight" to come back to. | No false-positive complaints found, because it does not listen ambiently. | [12] |
| **Google Pixel "Now Playing"** | Nothing goes to your library on its own. | No. | Songs it identifies nearby show on the lock screen and go into a **History** list. You favourite the ones you want, or swipe to remove. | Not about noise; mostly "stopped detecting" bugs. | [13] |
| **Shazam / Auto Shazam** | Nothing goes to a playlist unless you connect one. | No. | With Auto Shazam on, it keeps identifying songs around you until you turn it off. Matches go to your Shazam Library or history. | None found about noise. | [14] |
| **Apple notification summaries** (iOS 18.3, Jan 2025) | AI summaries were shown in place of real alerts. | No. | n/a | Invented headlines (BBC: "Luigi Mangione shot himself"). Apple **paused the whole News & Entertainment category**, labelled summaries "beta, may contain errors", put them in italics, and added a per-app off switch on the lock screen. | [15] [16] |
| **Otter** | AI action items are created automatically from meetings. | No, but each one can be edited, reassigned or deleted. | Each action item links to "View in transcript", the exact moment it came from. | n/a for noise; it is meeting-scoped. | [17] |
| **Granola** | Nothing until you open the meeting note. It does not transcribe in the background. | Your own typed notes steer what the AI writes. | Transcript. | A long-time user still checks every name, number and commitment against the transcript. | [18] |

**What the table says** (Inference): every product that listens all the time ends up with three layers. There is a raw layer (the transcript or history), a quiet layer (discarded conversations, Now Playing history), and a short list the owner acts on (suggested to-dos, favourites). The trouble starts when overheard media skips the quiet layer and lands in the short list. That is where Earmark is today: ads land on the shelf at >0.9 and in Maybe? at 0.6–0.9.

Rewind is not in the table. I did not get past search snippets for it, so I have left it out rather than guess.

---

## 3. What the research says

- **Act, ask, or do nothing, depending on confidence.** (Evidence [19].) Horvitz's paper on mixed-initiative interfaces (software where both the person and the AI can take the first step) sets two cut-offs. Below the first, do nothing. Between the two, open a short dialog with the user. Above the second, act. He also argues for "doing less but doing it correctly under uncertainty" and for "minimizing the cost of poor guesses". Earmark's 0.6 / 0.9 tiers are exactly this structure. **Inference:** the cut-offs are fine. The problem is that Jev's confidence measures "a nameable thing was mentioned", which ads score highly on. It does not measure "someone recommended this to me". A better question fixes this; moving the numbers does not.
- **When in doubt, do less, and make dismissing easy.** (Evidence [20].) Microsoft's 18 guidelines for human-AI interaction include G3 "time services based on context", G8 "support efficient dismissal", G9 "support efficient correction" and G10 "scope services when in doubt", which means engaging in disambiguation or gracefully degrading the AI system's services when uncertain about a user's goals.
- **Decide which mistake is worse before you tune.** (Evidence [21].) Google's People + AI Guidebook: weigh false positives (it saved something you didn't want) and false negatives (it missed something you did) differently, because their real costs differ. Precision (how many saved items are right) and recall (how many right items got saved) trade off against each other. Showing low-confidence results "can help users trust that the system isn't missing anything", or it can make them trust it less. Test it.
- **Extra suggestions are tolerated only when ignoring one is free.** (Evidence [22].) In a Microsoft study of an email meeting-detector with the same 50% accuracy, the version tuned to catch more (more false positives) was rated more accurate and more acceptable than the cautious version. The authors put this down to "lower cost of recovery" from a false positive. **Inference:** this is the strongest argument *for* keeping overheard items. It holds only if a wrong one costs the owner nothing. Today it does cost them: 42 manual clears. A quiet log makes it free.
- **Seeing an algorithm err costs trust out of proportion.** (Evidence [23], abstract only.) People lose confidence in an algorithm faster than in a human after watching it make the same mistake, even when the algorithm does better overall.
- **Too many low-value alerts teach people to ignore the important ones.** (Evidence [24].) In medicine, "alert fatigue" happens because most alerts are inconsequential. Clinicians then ignore both the meaningless alarms *and* the critical ones. **Inference:** a Maybe? row that is mostly ads trains the owner to skip the row, real tips included.
- **Interruptions cost stress, even when work gets done.** (Evidence [25], abstract only.) Interrupted people work faster but report more stress, frustration and time pressure.
- **Batch, don't drip, and don't switch off entirely.** (Evidence [26], highlights only.) Delivering phone notifications 3 times a day improved wellbeing, while turning alerts off completely raised anxiety and fear of missing out. **Inference:** this supports a once-a-day look at a quiet log over both a live drip (today) and a hard off switch (Option 3).

---

## 4. Patterns that fit Earmark

| Pattern | What it is | Who uses it | How it would look in Earmark | Cost / risk |
|---|---|---|---|---|
| **Deliberate always wins** | Anything the owner explicitly asked to keep is saved, no scoring. | Plaud, Granola, Bee Voice Notes [12][18][4] | "Earmark that" and Bee voice notes go straight to the shelf. This already works: 9 of 9 kept. | None. Keep it. |
| **Person attribution as the gate** | A tip needs a recommender, someone telling the owner to try it. | Bee's own framing ("the book your friend suggested") [6]; Limitless Consent Mode used voice ID [7] | Jev answers a narrower question: "Is a person recommending this to the owner?", not "Is a product named?". | Ads speak in the second person ("you should try…"), so a naive check will still pass some ads. Bee's speaker labels are unreliable [1][2][3], so the check must read the words, not trust speaker IDs. (Inference) |
| **Quiet log, not delete** | Low-confidence or out-of-scope captures are kept out of sight and can be brought back. | Omi "Show Discarded Conversations" [9]; Pixel Now Playing History [13]; Shazam history [14] | A "Heard nearby" list behind one link on the Shelf or in Settings. No badge, no count on Home, no notification. Each row shows the name, time and the transcript line it came from. One tap promotes it to the shelf. | Another screen to build. If the owner never opens it, real overheard tips are effectively lost; that is the price of zero interruptions. Auto-expiry is my suggestion (7 days, Inference), not something I found a product doing. |
| **Confidence tiers (act / ask / ignore)** | Thresholds that decide save, review or drop. | Horvitz [19]; Earmark today | Keep 0.9 / 0.6, but only for person-attributed tips. | Tiers only help if the score measures the right thing (see section 3). |
| **Provenance line** | Every AI item shows where it came from. | Otter "View in transcript" [17]; Apple italics and labels [16] | Every overheard tip shows "Heard 3:12 PM, '…Sam said you have to hear…'". Deliberate ones show "You saved this". | Small. Ads become obvious at a glance, so clearing is faster. |
| **One-tap dismiss that teaches** | Dismissing is instant, and it feeds back into the filter. | Bee accept/reject [2]; Microsoft G8/G9 [20]; PAIR feedback [21] | Swipe-to-clear on Maybe? and on the log. Cleared overheard names become examples for the broadcast filter. | The learning part needs care so one clear doesn't block a real later tip. |
| **Daily digest** | One batched moment a day instead of a drip. | Bee 8 PM summary [1]; batching study [26] | Optional: "3 things you heard today" in the existing daily flow, drawn from the quiet log. | Adds back a small interruption. Leave it out at first and add it only if the log goes unread. (Inference) |
| **Pause the bad category, not the product** | Turn off the one kind of output that is failing. | Apple paused News & Entertainment summaries only [15][16] | Stop person-less overheard tips. Leave person tips, deliberate tips and ideas alone. | This is Option 1. |
| **Caps / budgets** | At most N items a day reach the owner. | Not found as a named pattern in these products. | Option 2's 3/day cap on Maybe?. | At roughly 18% precision for person-less overheard tips (9 kept of 51), 3 a day is about 2.5 ads and 0.5 real tips. That is alert-fatigue territory [24]. (Inference) |

---

## 5. Recommendation for Earmark

**Option 1, with a quiet log instead of deletion.**

What gets saved where:

1. **Deliberate capture** ("Earmark that", Bee voice note) goes straight to the shelf. No change.
2. **Overheard, with a person recommending it to the owner** keeps today's tiers: above 0.9 to the shelf, 0.6–0.9 to Maybe?, below 0.6 dropped. Each one carries a provenance line.
3. **Overheard, no person** is not a tip. It goes to **Heard nearby**, a quiet list: no badge, no Home row, no notification. Each item shows the transcript line. One tap moves it to the shelf, and swiping clears it. Items expire after 7 days.
4. **Ideas** stay ambient, unchanged.
5. **Broadcast filter**: tighten it anyway. Ads and YouTube that still slip through then land in the quiet log rather than in front of the owner.

What the owner sees: a shelf that holds only things they said or someone told them about, a Maybe? row that should be short without needing a cap, and a log they can browse when curious.

Honest downsides:

- **Some real tips will be quieter.** A radio DJ or podcast host recommending an album the owner *does* want will go to the log, not the shelf. For someone who works in radio, that may happen often. The log is the safety net, but only if the owner looks at it.
- **The person check will make its own mistakes.** Ads say "you should…", and Bee's speaker labels are unreliable. Expect some ads to pass as person tips, and some real tips (a friend mentioning something in passing) to fail.
- **The evidence for the person rule is thin.** It rests on one kept person-tip. That one data point fits the rule; it does not prove it.
- **More to build than Option 3.** It needs a new list view and a provenance line. Option 3 is a switch.

**How we'll know it worked** (all countable from tip status data):

- Cleared rate for overheard tips that reach the shelf or Maybe? falls from **82% to 25% or less** over the 7 days after launch.
- Cleared rate for deliberate captures stays near **0%**.
- Fewer than **1 in 10** "Heard nearby" items get promoted. More than that means the person rule is too strict and the line needs moving.
- Maybe? averages **3 or fewer items a day** with no cap applied.

---

## 6. Sources

1. Victoria Song, "Bee review", The Verge, 2025-03-12. https://www.theverge.com/reviews/627056/bee-review-ai-wearable
2. Sam Julien, "Bee First Impressions". https://www.samjulien.com/bee-first-impressions/
3. Lucas Ropek, "I tried Amazon's Bee wearable…", TechCrunch, 2026-05-24. https://techcrunch.com/2026/05/24/i-tried-amazons-bee-wearable-and-am-both-intrigued-and-slightly-creeped-out/
4. Maria de Lourdes Zollo, "Building Bee at Amazon", About Amazon, 2026-01-05. https://www.aboutamazon.com/news/devices/bee-amazon-wearable-ai-device-new-features
5. "Bee Frontier and Bee Eclipse", About Amazon, 2026-10-15. https://www.aboutamazon.com/news/devices/amazon-personal-ai-bee-frontier-bee-eclipse
6. Michael Kan, "Amazon's New 'Bee' Wearables…", PCMag, 2026-10-15. https://www.pcmag.com/news/amazons-new-bee-wearables-listen-to-your-conversations-suggest-actions
7. "Limitless AI Pendant…", Business Insider, 2024-04-16. https://www.businessinsider.com/limitless-ai-pendant-clips-clothes-hears-records-everything-2024-4
8. "Omi AI (CV1) Two Month Review", r/OmiAI. https://www.reddit.com/r/OmiAI/comments/1qy1ax0/omi_ai_cv1_two_month_review_whats_better_whats/
9. Omi feedback board, "Missing conversations" (search snippet). https://feedback.omi.me/p/missing-conversations
10. Omi GitHub issue #6154, "Auto-discard conversations under 30s". https://github.com/BasedHardware/omi/issues/6154
11. Kylie Robison & Boone Ashworth, "I Hate My Friend", WIRED, 2025-09-08. https://www.wired.com/story/i-hate-my-ai-friend/
12. "New Plaud AI NotePin S Adds Recording Button…", PCMag. https://me.pcmag.com/en/ai/34438/plaud-ai-notepin-s-introduces-recording-button-desktop-app-for-online-calls
13. Google, "Find out what music is playing near you", Pixel Phone Help. https://support.google.com/pixelphone/answer/7535326?hl=en
14. Apple, "Use your Apple device to identify what song is playing". https://support.apple.com/en-us/118570
15. BBC, "Apple suspends error-strewn AI generated news alerts", 2025-01-17. https://www.bbc.com/news/articles/cq5ggew08eyo
16. Emma Roth, "Apple is pausing notification summaries for news…", The Verge, 2025-01-16. https://www.theverge.com/2025/1/16/24345331/apple-notification-summaries-pause-news-ios-18-3-beta
17. Otter Help, "Action Items Overview". https://help.otter.ai/hc/en-us/articles/25983095114519-Action-Items-Overview
18. Zachary Proser, "Granola AI Review (2026)". https://zackproser.com/blog/granola-ai-review
19. Eric Horvitz, "Principles of Mixed-Initiative User Interfaces", CHI 1999. https://erichorvitz.com/chi99horvitz.pdf
20. Amershi et al., "Guidelines for Human-AI Interaction", CHI 2019. https://www.microsoft.com/en-us/research/wp-content/uploads/2019/01/Guidelines-for-Human-AI-Interaction-camera-ready.pdf
21. Google PAIR, People + AI Guidebook, "User Needs + Defining Success". https://pair.withgoogle.com/chapter/user-needs/
22. Kocielnik, Amershi & Bennett, "Will You Accept an Imperfect AI?", CHI 2019. https://www.microsoft.com/en-us/research/wp-content/uploads/2019/01/chi19_kocielnik_et_al.pdf
23. Dietvorst, Simmons & Massey, "Algorithm Aversion", J. Exp. Psych: General, 2015. https://pubmed.ncbi.nlm.nih.gov/25401381/
24. AHRQ PSNet, "Alert Fatigue" primer (reviewed 2024). https://psnet.ahrq.gov/primer/alert-fatigue
25. Mark, Gudith & Klocke, "The Cost of Interrupted Work: More Speed and Stress", CHI 2008. https://dl.acm.org/doi/10.1145/1357054.1357072
26. Fitz et al., "Batching smartphone notifications can improve well-being", Computers in Human Behavior, 2019. https://www.sciencedirect.com/science/article/abs/pii/S0747563219302596

---

## 7. What I couldn't confirm

- **Whether Bee shipped the broadcast "liveness detection"** promised in March 2025 [1]. The 2026 launch post mentions "advanced noise filtering… ignore what doesn't [matter]" [5], which is about background noise, not TV. A 2026 reviewer saw Bee label a movie night correctly [3]. That is one anecdote, not a feature.
- **Whether Bee's 2026 suggested to-dos still need accept/reject**, or are added automatically. PCMag says "automatically adding tasks" [6]; Amazon lists "suggested to-dos" as a Pro feature [5]. The accept/reject evidence [2] is from early 2025.
- **Limitless and Omi**: whether action items need confirmation. Not found. The Limitless mislabelling claim rests on reviews I saw only as search snippets.
- **Rewind**: left out. I did not read a primary source.
- **Sources read as abstracts or snippets only**: Dietvorst [23] (abstract), Mark [25] (abstract), Fitz [26] (publisher highlights; full text was blocked), Omi feedback board [9] (snippet).
- **Whether the person rule would actually have caught Earmark's 42 cleared tips.** I was told not to open the transcripts, so I could not test it. This is the most important open question. Run the rule against the 51 person-less tips offline before shipping.
- **The 7-day expiry and the "under 1 in 10 promoted" threshold** are my judgement, not figures from any source.
