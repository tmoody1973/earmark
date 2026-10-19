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

**What actually happened:**
