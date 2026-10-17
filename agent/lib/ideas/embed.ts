import { embed } from "ai";
import { getEnv } from "../env";

// Pinned: idea_clusters.centroid and idea_mentions.embedding are vector(1536). A new model means re-embedding every row.
export const EMBED_DIMENSIONS = 1536;

export async function embedText(text: string, opts: { embedImpl?: typeof embed } = {}): Promise<number[]> {
  const run = opts.embedImpl ?? embed;
  const { embedding } = await run({ model: getEnv().EMBED_MODEL, value: text });
  if (embedding.length !== EMBED_DIMENSIONS) {
    throw new Error(`Expected a ${EMBED_DIMENSIONS}-dim embedding, got ${embedding.length}`);
  }
  return embedding;
}

export function toVectorLiteral(v: readonly number[]): string {
  return `[${v.join(",")}]`;
}
