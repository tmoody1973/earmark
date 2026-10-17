// The one recipe for a tip's text (decision 026): recommendations.embedding is made from it, and Jev reads it when it
// judges whether a tip fits an idea. Type, name, creator and the context summary only: never the excerpt or raw text.
// Owner: lane A (M3-T5). The rec lane sweep embeds this text and nulls the embedding when the name, creator or why
// changes (lane.ts saveMatch / writeWhys); the backlink refresh also fills any that are missing (decision 015).

export interface RecEmbedInput { type: string; name: string; creator: string | null; contextSummary: string | null }

const MAX_WORDS = 80; // short state reads best (Jev jaggedness #6), and is plenty for an embedding
const clip = (s: string) => s.split(/\s+/).filter(Boolean).slice(0, MAX_WORDS).join(" ");

export function recEmbedText(r: RecEmbedInput): string {
  const type = r.type === "film_tv" ? "film or TV" : r.type;
  const head = `${type}: ${r.name}${r.creator ? ` by ${r.creator}` : ""}`;
  return clip([head, r.contextSummary].filter(Boolean).join(". "));
}
