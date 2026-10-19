export type ItemKind = "idea_by_user" | "rec_to_user" | "rec_by_user" | "neither";
export type RecType = "album" | "song" | "artist" | "book" | "place" | "podcast" | "film_tv" | "video" | "other";

export interface TriageResult {
  kind: ItemKind;
  kindProbability: number;           // probability of the chosen kind = routing confidence
  recType: RecType | "none";
  recTypeProbability: number;
  jokingProbability: number;         // P(clearly a joke or hypothetical)
  broadcastProbability: number;      // P(ad, station ID or scripted broadcast audio, not live speech)
  correctionProbability?: number;    // deliberate earmarks only (triageWindow opts.correction): P(it corrects a saved tip)
  model: string;
  providerMetadata: unknown;         // logged; confidence key via Gateway unverified
}
