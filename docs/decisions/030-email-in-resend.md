# 030 — Forward an email to Earmark with Resend's receiving address, and accept only the owner's forwards

**Decision:** To save a recommendation that arrives by email, Tarik forwards it to an Earmark address hosted by Resend (the email service Earmark already plans to use). Resend calls an Earmark web address (a webhook, meaning a "something happened" message sent to a URL) with the email's id; Earmark checks the message is genuinely from Resend, fetches the email, checks it came from Tarik's own address, and saves the recommendation. Mail from anyone else is ignored.

**Why this came up:** Friends recommend things by email as often as in conversation, and those never reach Bee. An address that accepts forwards is the cheapest way to catch them. The risk is that anyone who learns the address could fill the shelf with junk or with fake recommendations, so the sender check matters as much as the receiving.

**Options:**

| Option | Cost | Setup | Catch |
|---|---|---|---|
| **Resend inbound (chosen)** | Free plan includes receiving; each received email counts toward 3,000 a month and 100 a day | A Resend-provided `<id>.resend.app` address, no DNS (the settings that point a web name at a service) | The webhook carries metadata only; the body needs a second call to Resend |
| Postmark inbound | Free plan is 100 emails a month; inbound appears only on paid plans | `hash@inbound.postmarkapp.com` | Likely a paid plan for the demo |
| Cloudflare Email Routing to a Worker | Free | The domain must be on Cloudflare, plus a separate Worker program | A second place to deploy for one feature |

(Prices and limits read from the vendors' pricing pages on 2026-10-16.)

**What we chose and why:** Resend inbound, decided by Claude, following Tarik's plan for the capture channels. It is free, needs no DNS work, and sits in the same Next.js app as the rest of the capture routes. Three design choices ship with it:

- **Retries are harmless.** Resend resends a webhook until it gets a success reply, so every email is claimed by its Resend id in a small table (`processed_emails`) before work starts. The claim is a single database statement that only one delivery can win, so a second delivery of the same email answers 200 and does nothing. If processing fails, the claim is deleted so the retry can succeed; if the server dies mid-way, the claim expires after 10 minutes. The table keeps only the id, timestamps, outcome and the saved recommendation's id, never the email's text, subject or addresses.
- **A forward is a request to save.** If Earmark's triage model doubts the email is a recommendation to Tarik (or thinks it is a joke), the item is still saved, but marked "needs review" rather than dropped. The saved confidence is the model's real probability, not a hard-coded 1.
- **Same save path as photos and songs.** It goes through the shared capture save, so it gets the same duplicate handling, the same rule that Tarik is never credited as a recommender, and the same 25-word limit on stored excerpts.

**The owner check can be fooled:** Earmark decides "this is Tarik" from the email's From address. That address is written by the sender and can be forged. The webhook signature proves the message came through Resend, not that Tarik sent it. Resend's received-email data has no SPF or DKIM result field (these are the two checks a receiving mail server runs to see whether a message really came from the domain it claims; DMARC is the policy that combines them and says what to do when they fail). It does return the raw message headers, so Earmark looks in them for an `Authentication-Results` or `Received-SPF` line and rejects the email if any of SPF, DKIM or DMARC is stated as a failure. A line saying "pass" is not trusted, because a sender can write any header they like, and a missing line is not treated as a failure. We have not yet seen a real Resend message to confirm whether those headers are present at all. If they are not, the From address is the only check.

**How the sender is read:** the address is taken from the last `<...>` group in the From line, because a sender can put a fake `<owner@...>` inside a quoted display name. A From line with more than one mailbox, or stray brackets, counts as not the owner. The match is exact, so `owner+tag@...` is also refused: safer to turn away a variant than to guess.

**What we gave up:**
- **A rare double save.** After saving, Earmark marks the email "done". If that last step fails, the email stays marked "processing"; Resend will not retry (it got a success reply), but a manual replay after 10 minutes could save the recommendation a second time.
- **Forgery is possible.** Someone who knows both the secret receiving address and Tarik's email address could send a forged message that passes. The damage is bounded: it can only add a recommendation (a short excerpt, a first name, up to three links) to a shelf with one owner, nothing is deleted or exposed, and the odd entry is easy to dismiss. Accepting that is reasonable for a single-owner hackathon app; it would not be for anything with several users. The fix, if it matters later, is to require a stated DMARC pass, or to put a secret word in the forward.
- **A second Resend call per email,** because the webhook has no body.
- **Another secret surface.** Three more settings (an API key, a webhook signing secret, the owner's email) and a public endpoint; while any setting is blank the endpoint refuses everything.
- **Junk rows.** Every ignored email still leaves one tiny row in `processed_emails`.
- **One recommendation per email.** A forward listing several things yields one.

**How we'll know if this was right:** After the first real forward: the shelf shows one new recommendation with source "email" and the friend's first name, and replaying the same webhook in the Resend dashboard answers "duplicate" without adding a second. Then check the Resend message for an `Authentication-Results` header; if it is missing, the forgery gap above is the whole story. Over a month, `select outcome, count(*) from processed_emails group by 1` should show almost no "ignored" rows; many would mean the address is leaking.

**What actually happened:**
