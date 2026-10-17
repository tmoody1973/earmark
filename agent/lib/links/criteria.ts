import type { BooleanQuestion } from "../decide/ask-booleans";

// Tuning knobs: starting points, adjust after looking at real links (M4-T11). Decision 026.
export const LINK_MIN = 0.7; // show a related idea / a tip that fits at or above this P(yes)
export const MERGE_MIN = 0.8; // offer "same idea?" at or above this P(yes)
// Embeddings only narrow the field; Jev decides. Cosine distance between idea centroids, and from a tip to a centroid
// (a tip's text is a different shape from an idea's, so its floor is looser). Each item also meets at most
// NEIGHBOURS_PER_ITEM nearest partners, so the knobs bound the work, not just the distance.
export const IDEA_PAIR_MAX_DISTANCE = 0.55;
// M4-T11 (prod, read-only): every visible tip's nearest idea sat 0.65–0.80 away (median 0.715), so 0.7 let 3 of 13 tips
// reach Jev at all and none was shown. 0.75 lets 9 of 13 through (27 pairs, one-off ≈ 21 extra Jev calls ≈ $0.001).
export const REC_IDEA_MAX_DISTANCE = 0.75;
export const NEIGHBOURS_PER_ITEM = 5;

// Jev reads literally (docs/research/triage-models.md §2): each instruction names the state fields and asks one
// exact condition; each side states what counts, with the boundary case. Examples are synthetic, never transcript text.
// "Same idea" matches the compost's own rule (choose-cluster.ts): same core proposal, whatever the format.

export const SAME_IDEA: BooleanQuestion = {
  instructions:
    "Do `idea_a` and `idea_b` propose the same core thing, so that they are one idea written down twice?",
  whenTrue:
    "Both propose the same core thing: the same subject and the same deliverable, even if worded differently, at a " +
    "different level of detail, or in a different format that carries the same content (a newsletter issue and a radio " +
    "segment about the same history are the same idea). Example: 'a weekly segment visiting one record store' and " +
    "'record store Saturdays, a short visit to a different shop each week'.",
  whenFalse:
    "They propose different things: a different subject, or a different deliverable on the same subject, even if they " +
    "share a broad topic, a person, a place or a format. Example: 'a record store segment' and 'a record store map " +
    "for the website' are different ideas.",
};

export const RELATED: BooleanQuestion = {
  instructions:
    "Do `idea_a` and `idea_b` share a specific subject, a specific person, or specific source material?",
  whenTrue:
    "Both name or clearly describe the same specific subject, person, event, place or piece of source material, so " +
    "work on one could use the other. Example: 'an oral history of the station's first broadcast' and 'a newsletter " +
    "issue on the original transmitter log'.",
  whenFalse:
    "They only share a broad theme (music, radio, the city, technology), an audience, or a format such as a newsletter " +
    "or a podcast, even if both are about the same field. Example: 'a jazz history series' and 'a playlist of new " +
    "pop releases' only share music.",
};

export const FITS: BooleanQuestion = {
  instructions:
    "Could the recommended item in `rec` be used as material in the idea in `idea`: cited, featured, played, " +
    "discussed or used as research?",
  whenTrue:
    "The item matches the specific subject of the idea, so it could appear in it or inform it as described. Example: " +
    "a 1960s jazz record from the city for 'a radio series on the city's jazz history'; a book on oral history " +
    "methods for 'recording listeners' family stories'.",
  whenFalse:
    "The item only shares a broad theme with the idea, or nothing in the idea is something this item could serve, " +
    "even if both mention the same city or the same kind of thing. Example: a ramen restaurant for 'a radio series on " +
    "the city's jazz history'.",
};
