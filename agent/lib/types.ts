// The triage types live in the eve-bee package (one copy); everything else here is Earmark-only.
export type { ItemKind, RecType, TriageResult } from "../../packages/eve-bee/src/types";
export type Route = "accept" | "review" | "drop";
export type Source = "ambient" | "voice" | "photo" | "song" | "email";
export type AttributionSource = "voice_trigger" | "second_person" | "summary" | "slack" | "email" | "none";
export type IdeaStage = "compost" | "sprouting" | "ready" | "drafted" | "used" | "dismissed";
// overheard: Heard nearby (decision 052), an overheard tip nobody recommended; only that quiet log shows it.
export type RecStatus = "needs_review" | "new" | "queued" | "tried" | "thanked" | "dismissed" | "composted" | "overheard";
export type Rating = "loved" | "fine" | "not_for_me";

// id: Bee's utterance id when REST sent one (identity of a deliberate "Earmark that" within its conversation).
export interface Utterance { text: string; speaker: string; spokenAt: Date | null; id?: number | null }

export interface TranscriptWindow {
  conversationId: number | null;     // Bee REST numeric id
  conversationUuid: string | null;   // Bee stream uuid
  utterances: Utterance[];
  text: string;                      // "Unknown: …\nUnknown: …" — what Jev sees
  startedAt: Date | null;
}

export interface RecExtraction {
  canonicalName: string;
  creator: string | null;            // artist / author / host / director / channel
  recommenderName: string | null;    // as written in the source text, or null
  excerpt: string;                   // ≤ 25 words, verbatim from the window
}

export interface IdeaExtraction { title: string; excerpt: string }
