# 049 — "Fix this tip": the owner corrects a tip's words, and Earmark looks it up again

**Decision:** Tarik can now correct a tip's name, who it's by, its type, and its note. Changing the name, the "by" or the type sends the tip back to be looked up again from scratch, so its art, Wikipedia note, preview and credits come from the corrected words. Changing only the note just saves the note. A note Tarik writes is final: Earmark never writes over it. What Bee heard (the quote) is never editable.

**Why this came up:** Bee transcribes speech, and it mishears. A real case: tip 150 was saved as "Jemetta Rose's new albums" by Jemetta Rose, and its "why" line mentions "Sun Raw Records", where the speaker said Sun Ra. "Which one?" (decision 048) can't help here: it only chooses among the options a lookup already found for the words Bee heard, and the right item was never among them because the words were wrong. Sometimes the words are right but thin ("her new albums") and Tarik knows the album's name. What was at stake: a tip built on misheard words shows the wrong art, the wrong links and the wrong credits, and a tip Tarik can't correct is one he stops trusting.

**Options:**
1. **Edit the words only, keep everything else.** Cost: the art, Wikipedia note, preview and credits still belong to the item the old words matched, so the page shows a corrected name next to the wrong album cover.
2. **Edit the words and look the tip up again from scratch.** Cost: a correction clears what the old match produced (art, links, note, extras), and the page shows less for up to 10 minutes until the background lookup runs. If the lookup finds nothing, the tip keeps Tarik's words and no art.
3. **Edit the words and look it up immediately, in the request.** Cost: calls lookup services (MusicBrainz, which allows one request a second) from a page tap, which decision 012 kept out of request paths, and makes saving slow and able to fail for reasons Tarik can't fix.

**What we chose and why:** Option 2, chosen jointly; Tarik approved "go". Claude chose how it plugs in:
- One shared function (`applyTipFix`) does the fix, so all three ways in behave the same: the tip page's "Fix this tip" form (built now), editing the tip's Bee todo, and a spoken correction ("Earmark, that was Sun Ra"). The other two come next and call the same function.
- New words put the tip back in the lane's queue (the lane is the background job that looks tips up every 10 minutes, decision 013) exactly as a brand-new tip waits there, and clear what the old match left: the art, the provider links, the Apple Music id, the year or address, a place's map location, the Wikipedia note, the extras (preview, credits), the stored "Which one?" options and any earlier pick or "None of these". So the lane is allowed to look again, and "Which one?" can ask again if it isn't sure. What a capture brought itself stays, as in decision 048: a photo keeps its picture, a shared song keeps its Apple Music link and id, and a capture's own web link stays.
- When the lane finds the item, the service's spelling replaces Tarik's typing ("sun ra" becomes "Sun Ra"); that's intended. If it finds nothing, his words stay.
- The note is the tip's "why" line, which the lane normally writes with a model from what was said. A new column, `why_source` (who wrote the why: `auto` for the lane, `owner` for Tarik), marks Tarik's note, and the lane's why step skips those tips, so it can never overwrite his words. Clearing the note hands it back to the lane (`auto`), which writes a fresh why on its next run.
- The save only lands if the tip is still exactly what the page showed. If the lane or another tab changed it in between, nothing is written and the page says "This tip changed, or was cleared. Reload to see it." A cleared tip (dismissed or composted) can't be fixed. The other direction is covered too: a lookup takes a few seconds, and if Tarik saves a fix while the lane is in the middle of looking up the old words, the lane notices the tip was sent back to the queue after it started (it remembers when the tip entered the queue) and throws its result away, so the old words' match can't overwrite the fix.
- If the tip is queued ("Try this") and has a Bee todo, the todo's text follows on its own: the Bee todo job (every 10 minutes, when Bee writes are on) rewrites a todo whenever the tip's name, maker or type no longer match it. No new Bee code.

**What we gave up:** A correction wipes the old match's art and extras before the new ones arrive, so for up to 10 minutes the page is plainer, and for good if the lookup finds nothing. A note stays as Tarik wrote it even if the tip is later corrected: Earmark won't rewrite a note he chose. The "why" line the lane wrote from the misheard words is not rewritten when only the name changes (it was written from what was said, which still says "Sun Raw"); Tarik fixes it by editing the note. The quote can't be corrected at all, by design: it is the record of what was actually said. And one more column on the tips table.

**How we'll know if this was right:** Tip 150, corrected on the page, shows Sun Ra's album art, Wikipedia note and credits within about 20 minutes (two lookup runs: the match, then the extras), with "Sun Raw" gone from the name. And over time, corrected tips mostly end up matched, which the database can answer at any time:

```sql
-- Tips Tarik wrote a note on, and how corrected tips are doing (corrections clear owner_pick and reset match_source,
-- so this counts the lookup outcome, not who fixed it).
select why_source, enrichment_status, count(*) from recommendations
where status not in ('dismissed', 'composted') group by 1, 2 order by 1, 2;
```

If many corrected tips still end up unmatched, the lookup services need better queries for the owner's words, or the form needs a hint about what to type.

## Piece 2: from the Bee app

**What it does:** Tarik can now fix a tip by editing its todo in the Bee app. If he changes "Earmark · Listen: Jemetta Rose's new albums, Jemetta Rose (Oct 16) …" to "Earmark · Listen: Lanquidity, Sun Ra (Oct 16) …", Earmark takes that as a correction and looks the tip up again, through the same `applyTipFix` the tip page uses.

**How it works, in order:** Each time the Bee todo job runs (the reconciler, the job that makes Bee's todos match Earmark's tips), it compares every open tip todo's text in Bee with the text Earmark last wrote there. If they differ, Tarik edited it. Earmark first tries to read the new words as its own format: verb, name, "by", the (who, day) part, and the link. He may delete the link or the parentheses. Only if he rewrote it freely does Earmark make one small model call, and that call sees the two todo texts and nothing else, never what was said. Then Earmark writes the clean text back to Bee and applies the fix. Bee is written first, so if Bee fails or the job crashes halfway, the next run reads the same edit again, and the fix is only applied once.

The verb changes the type only when it points to one type: Read means a book, Visit a place, Try "other". Listen and Watch each cover several types, so a change to one of them goes to the model.

If the edit isn't a correction (a note to self, "ask Ann which pressing"), Earmark leaves his text alone in Bee and remembers it has already read that edit, so it doesn't ask again every run.

**A correction to piece 1:** the bullet above says the todo's text "follows on its own… No new Bee code." That was wrong. The job only wrote text when it made a todo, so a fix on the tip page never reached an open todo. Now it does: a todo Tarik hasn't edited gets the tip's new text on the next run, both after his fix and again when the lookup replaces his typing with the service's spelling ("sun ra" becomes "Sun Ra").

**What we gave up:**
- The first run after this ships rewrites every open tip todo whose text is out of date, including old ones that still link to the Shelf instead of the tip's page, at most 10 writes per run.
- If the model call fails, the edit is treated as "not a correction" and isn't retried. Tarik has to edit it again.
- An edit that only shortens the text (say, deleting the link) is left as he wrote it, and that todo stops getting later name updates.
- If the fix itself fails after Bee was written, the next run puts the tip's old words back in Bee, so Bee never claims a fix Earmark doesn't have.
- An edit made while the todo is checked off isn't read.

**How we'll know if this was right:** Editing tip 150's todo in Bee to "Lanquidity, Sun Ra" shows the new name on the tip page and a clean todo in Bee within one run. Edits Earmark read and left alone are countable at any time. If many of them are real corrections, the parsing or the model prompt is missing them:

```sql
select count(*) from bee_sync where entity_type = 'rec' and bee_object = 'todo' and last_written_state ? 'seen';
```

## Piece 3: say it out loud

**What it does:** Tarik can fix a tip by saying so to his Bee: "Earmark, that Sun Raw tip should be Sun Ra, the musician", or, as a voice note, "Earmark that: the Jemetta Rose album is actually Lanquidity by Sun Ra." Earmark works out which recent tip he means and puts a card on Home: "Fix *Jemetta Rose's new albums* → *Lanquidity, Sun Ra*?" with **Apply** and **Ignore**. Apply changes the tip through the same `applyTipFix` the tip page and the Bee app use, and the tip is looked up again. Ignore leaves the tip as it is. Tapping either twice does nothing the second time.

**Why it never applies a fix by itself:** the whole reason a tip needs fixing is that Bee mishears. A spoken correction goes through the same ears. "Sun Ra" could come back as "Son Raw", or the correction could be matched to the wrong tip. If Earmark applied it straight away, one mishearing would quietly overwrite a tip that was fine, and its art and links would be wiped for a fresh lookup. So the spoken fix is only ever a proposal (a suggested change that waits for a yes). Tarik sees the old words and the new words side by side and decides. The proposal stores only the new name, creator and type (each 120 characters at most) and which conversation or voice note it came from, never what was said.

**How it works, in order:**
1. Only a *deliberate* earmark can be a correction: a voice note or "Earmark that / Earmark, …" said in a conversation. Those are the moments Tarik is talking *to* Earmark. Ordinary talk (ambient windows, the overheard stretches of a conversation) is never treated as a correction, and its triage questions are exactly what they were before.
2. The triage call for a deliberate earmark gets one extra yes/no question: "is this correcting a tip Earmark saved?" Triage is the small classifier model, Jev, that already decides idea versus recommendation. If Jev is at least 80% sure, Earmark treats it as a correction and does not save a new tip. Below that, the earmark is saved exactly as before.
3. A model call pulls out the words Tarik used for the tip as it is now ("Sun Raw") and the right words ("Sun Ra", plus the creator and type only if he said them).
4. Earmark lists the tips saved in the last 30 days that aren't cleared, and keeps the 3 whose spelling is closest to his words. Closeness is scored on three-letter chunks, so a word misheard a second time still lands near.
5. Jev picks one of those 3 or answers "none of these". The options are shuffled, because Jev leans toward whichever comes first. If it isn't at least 80% sure, or the tip already says those words, nothing is stored and the log records only ids.
6. The proposal is saved in the same database transaction as the rest of that conversation or voice note. A transaction is an all-or-nothing write: either everything from that conversation lands or none of it does. The corrected name is also added to the conversation's "already earmarked" names, so if someone in the room says "Sun Ra is great" a minute later, that doesn't become a new tip either.

**Choices Claude made:** where to detect it. Options: (a) a new "correction" answer in the ambient classifier. That would change how every overheard window is sorted, which the brief ruled out. (b) A separate model call for every deliberate earmark. It's clean, but it costs an extra call each time. (c) One more question inside the deliberate earmark's existing triage call. Claude chose (c): no extra call, and ambient sorting is untouched.

**What we gave up:**
- A correction has to start with the trigger ("Earmark that…" or "Earmark, that…"). Saying "that Sun Raw tip should be Sun Ra" in passing does nothing.
- The extra question shares a call with the idea-or-recommendation question for deliberate earmarks. That could in principle nudge how Jev sorts those, and we have no labelled examples to measure it. Ambient windows are unaffected.
- If Jev wrongly decides a real earmark is a correction (80% or more sure), that earmark becomes a proposal or nothing at all, not a tip. The 80% bar is a guess, set like the "Which one?" match bar, not tuned on data.
- If Earmark can't tell which tip he means, nothing is kept and nothing tells him. He would notice no card on Home and could fix the tip on its page.
- By voice he can change the name, creator and type, but can't clear a creator or write a note. The tip page does those.
- Only tips from the last 30 days can be corrected by voice.
- If the extraction model returns garbage, the earmark falls back to the existing safety net: it is saved as a "Maybe?" tip with the spoken words as its title, so it is seen rather than lost.
- There is no "forget a conversation" command in Earmark, so "forgetting a conversation deletes its proposals" has nothing to hook into. Forgetting the *tip* deletes its proposals (they are tied to the tip's row and go with it), and the forget dry run counts them.
- One more table, `tip_fix_proposals` (migration 042).

**How we'll know if this was right:** Saying "Earmark, that Sun Raw tip should be Sun Ra" puts one card on Home for tip 150 within one processing run, with no new "Sun Ra" tip. Over time, Apply should far outnumber Ignore. Many Ignores mean Earmark is picking the wrong tip or hearing the fix wrong:

```sql
select status, count(*) from tip_fix_proposals group by 1 order by 1;
```

**What actually happened:**

## Link: when it only lives on one page

**What it does:** "Fix this tip" has a **Link** field. Tarik pastes where the thing lives, for example `https://jimettarose.bandcamp.com/album/mettasun`, and the tip gets that page's picture and a button to open it ("Listen on Bandcamp", or "Open link" for any other website). Some things exist only on Bandcamp or on their own website, so no lookup service will ever find them. Before this, those tips stayed as a blank card with a "no match" flag forever.

**Why a link settles the tip:** Earmark's lookups exist to answer "which thing did he mean?". A pasted link *is* the answer, from the one person who knows. So saving a link marks the tip as the owner's, the same way picking an option in "Which one?" does: Earmark stops looking it up, "Which one?" stops asking, and a later lookup can never write over it. If Tarik later changes the name or creator, that is new words, and the tip is looked up again as usual.

**How it works, in order:**
1. The link must start with `https://` and be at most 500 characters. Anything else (an `http://` link, a `javascript:` link, an address on Tarik's own network) is refused before anything is fetched.
2. Earmark looks at the host (the site part of the link) and picks one of three paths:
   - **Apple Music** (an album, song or artist link): Earmark asks Apple's catalog for that exact item by its id, the number at the end of the link. It gets the real name, the artist, the cover and the Apple Music link. No model guesses anything.
   - **YouTube**: Earmark asks YouTube for the video's thumbnail, the same way video tips already work. The tip keeps Tarik's words.
   - **Anything else** (Bandcamp, SoundCloud, a diner's website): Earmark opens the page and reads its share tags, the hidden lines a page carries so that link previews in messages show a title and a picture. The picture becomes the tip's art. If the title is Bandcamp's "MettaSun, by Jimetta Rose" and the tip has no "by" yet, Earmark fills in the name and the artist from it. Otherwise page text never replaces Tarik's words.
3. Opening a page someone pasted is a known risk called SSRF (server-side request forgery: tricking a server into fetching an address inside its own private network). Earmark reuses the guard it already had for podcast feeds and adds one check: it only opens https pages whose host, once looked up, points to public internet addresses, re-checks every redirect the same way, stops after 5 seconds and reads at most 1 MB.
4. If Apple, YouTube or the page doesn't answer, the link is still saved, just without a picture, and the page says so.
5. Emptying the Link field removes the link Tarik added. It never removes links a lookup service found.

**Choices Claude made:**
- *Where to read the page.* Options: (a) a full HTML parser library, (b) a few pattern matches for the two tags we need, like the podcast feed reader already does. Claude chose (b): no new dependency, and the tags are short and standard.
- *Whether the tip stays the owner's when the link is cleared.* Options: (a) hand it back to the automatic lookup, (b) keep it as the owner's. Claude chose (b): clearing the link doesn't say "I was wrong about what this is". To get a fresh lookup, change the name.
- *The Bandcamp player.* The brief offered, as a stretch, a tap-to-play Bandcamp player on the tip page. Claude skipped it: the player's size and layout would need checking on a phone, and the "Listen on Bandcamp" button already opens it.

**What we gave up:**
- Only one pasted link per tip. A new link replaces the old one.
- Clearing the link keeps the picture that link brought, until the name changes or a new link replaces it.
- The address check looks the host up once, and the fetch looks it up again a moment later. A site that deliberately changes its answer in between (called DNS rebinding) could slip past. Only Tarik can paste links, so this is acceptable for now; the fix, if links ever come from anyone else, is to make the fetch use the address that was checked.
- Some sites block automated visitors or build their pages with scripts. Those links save without a picture.
- An Apple Music link only works when Earmark's Apple Music keys are set; without them it saves the link alone.

**How we'll know if this was right:** Pasting the MettaSun Bandcamp link on its tip shows the cover and a "Listen on Bandcamp" button on the next page load, and the tip no longer appears as a "no match". Over time, tips the owner settled with a link should never show up in the lookup queue again:

```sql
select count(*) from recommendations
where match_source = 'owner' and (links ? 'bandcamp' or links ? 'web') and enrichment_status <> 'matched';
```

**What actually happened:**
