// Dry run of the email-in model chain (M5-T13): NO database writes, no Resend calls. Two real Gateway calls
// (triage + extraction) on a made-up forwarded email. Run:
//   node node_modules/tsx/dist/cli.mjs --env-file=.env.local scripts/email-dry-run.ts
// Prints kinds, probabilities, a boolean and the rec type only: never names, text or model output.
import { forwardedSenderName } from "../agent/lib/capture/email";
import { ownerFirstName } from "../agent/lib/env";
import { validNameFor } from "../agent/lib/pipeline/attribution";
import { extractRecommendation } from "../agent/lib/pipeline/extract";
import { triageWindow } from "../agent/lib/pipeline/triage";

const SUBJECT = "Fwd: you have to read this";
const TEXT = `Thought of you when I saw this one!

---------- Forwarded message ---------
From: Marguerite Ledoux <marguerite@example.com>
Date: Sat, Oct 17, 2026 at 9:12 PM
Subject: you have to read this

Dear friend, you have to read The Salt Orchard by Ines Varga. It is a quiet novel about three sisters
running a failing farm, and it made me think of you. I could not put it down.`;

const body = `${SUBJECT}\n${TEXT}`;
const triage = await triageWindow(body.slice(0, 1200));
const ext = await extractRecommendation({ text: body, summary: null });
const name = validNameFor(ownerFirstName(), forwardedSenderName(TEXT) ?? ext.recommenderName, TEXT, SUBJECT);

console.log(JSON.stringify({
  triageKind: triage.kind,
  kindProbability: triage.kindProbability,
  recType: triage.recType,
  recTypeProbability: triage.recTypeProbability,
  jokingProbability: triage.jokingProbability,
  recommenderFirstNameFound: name !== null,
  extractedType: triage.recType === "none" ? "other" : triage.recType,
  wouldSaveAs: triage.kind === "rec_to_user" && triage.jokingProbability < 0.5 ? "new" : "needs_review",
}));
