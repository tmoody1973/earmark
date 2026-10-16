export type ItemKind = "idea_by_user" | "rec_to_user" | "rec_by_user" | "neither";
export type RecType = "album" | "song" | "artist" | "book" | "place" | "podcast" | "film_tv" | "other";
export type Route = "accept" | "review" | "drop";
export type Source = "ambient" | "voice" | "photo" | "song" | "email";
export type AttributionSource = "voice_trigger" | "second_person" | "summary" | "slack" | "email" | "none";
export type IdeaStage = "compost" | "sprouting" | "ready" | "drafted" | "used" | "dismissed";
export type RecStatus = "needs_review" | "new" | "queued" | "tried" | "thanked" | "dismissed" | "composted";
export type Rating = "loved" | "fine" | "not_for_me";

export interface Utterance { text: string; speaker: string; spokenAt: Date | null }

export interface TranscriptWindow {
  conversationId: number | null;     // Bee REST numeric id
  conversationUuid: string | null;   // Bee stream uuid
  utterances: Utterance[];
  text: string;                      // "Unknown: …\nUnknown: …" — what Jev sees
  startedAt: Date | null;
}

export interface TriageResult {
  kind: ItemKind;
  kindProbability: number;           // probability of the chosen kind = routing confidence
  recType: RecType | "none";
  recTypeProbability: number;
  jokingProbability: number;         // P(clearly a joke or hypothetical)
  broadcastProbability: number;      // P(ad, station ID or scripted broadcast audio, not live speech)
  model: string;
  providerMetadata: unknown;         // logged; confidence key via Gateway unverified
}

export interface RecExtraction {
  canonicalName: string;
  creator: string | null;            // artist / author / host / director
  recommenderName: string | null;    // as written in the source text, or null
  excerpt: string;                   // ≤ 25 words, verbatim from the window
}

export interface IdeaExtraction { title: string; excerpt: string }
