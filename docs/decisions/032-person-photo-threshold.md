# 032 — A photo with any real chance of a person in it is never kept

**Decision:** When Earmark judges a shared photo, it asks a model "is any person, or any part of one, in this image?" and gets back a probability. If that probability is 0.2 or higher, Earmark still saves the recommendation (the book, album or place it read from the photo) but throws the photo away: no thumbnail is stored and no image is shown.

**Why this came up:** Tarik photographs things people are recommending to him, often in a room full of people, and a hand holding a record or a face at the edge of the frame is common. Earmark's promise is that it keeps recommendations, not pictures of people. A thumbnail with someone's face in it would sit in the garden and in the database for as long as the app exists, of a person who never agreed to that. If the threshold is too loose, faces get stored; if it is too tight, good cover photos get thrown away.

**Options:**
1. **Threshold at 0.5 (the usual "more likely than not").** Keeps the most thumbnails, but a person who is small or blurry in the background often scores 0.3 to 0.4, so their face would be stored. Real cost: privacy misses.
2. **Threshold at 0.2 (chosen).** Throws away a photo on even a modest chance of a person. Real cost: some clean cover photos lose their thumbnail.
3. **Blur or crop the people out and keep the rest.** Best result for the user, but it needs a face-finding step and is easy to get subtly wrong, so a face could still slip through. Not worth the risk for a first version.

**What we chose and why:** Option 2. Claude set the number while building the photo route (a ruling during lane C), and Tarik's earlier rule from the product spec, "no photos of people", is the reason it is strict. Losing a thumbnail is cheap, because the garden shelf shows the album or book cover that Earmark looks up from the title anyway. Storing a stranger's face is not cheap and cannot be undone once it has been copied or backed up. The question is also worded to say "true even if the person is small, blurry, in the background, or only partly visible", and if the model's answer is missing or malformed the code treats it as "a person is present" (it fails closed, meaning when unsure it takes the safe branch).

**What we gave up:**
- **Some good thumbnails.** A hand holding a vinyl sleeve will usually cost the thumbnail even though the cover was perfectly readable.
- **A tuned number.** 0.2 is a judgment call from reading the model's behaviour on a handful of images, not from measuring many photos.
- **A second line of defence.** The photo is still sent to the model vendors to be judged (see decision 034), so this rule protects what Earmark keeps, not what the vendors briefly see.

**How we'll know if this was right:** After the first two weeks of real use, count the photos saved without a thumbnail. If most of them were clean covers with no person (the check: open ten of them in the Shortcut's original photos), the threshold is too strict and can move toward 0.35. If any stored thumbnail ever shows a face or a hand, it is too loose, and moves down.

**What actually happened:**
