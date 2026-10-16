// One earmark per moment (M2-T14, MOO-938). Bee can hear the same words twice: as a voice note AND inside the ambient
// conversation that was recording at the same time (real case: conversation 11338188 vs voice notes 156–158). Two recs
// said within SAME_MOMENT_MS of each other are one item when they share a name, or the same recommender and type.

export const SAME_MOMENT_MS = 60_000;

// Compared names: lower case, no "(…)"/"[…]" asides, no punctuation, no leading article.
// "Kawa Ramen (ramen spot on Brady Street)" -> "kawa ramen"; "The Watchables" -> "watchables".
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/^(?:the|a|an) /, "");
}

// Short names ("pi") only match exactly: whole-word containment needs at least this many characters.
const MIN_CONTAINED = 4;

// Equal after normalizing, or one contains the other on word boundaries ("Shogun" ~ "Shogun on Hulu").
export function sameName(a: string, b: string): boolean {
  const [x, y] = [normalizeName(a), normalizeName(b)].sort((p, q) => p.length - q.length) as [string, string];
  if (!x) return false;
  return x === y || (x.length >= MIN_CONTAINED && ` ${y} `.includes(` ${x} `));
}

export interface MomentRec { name: string; type: string; firstName: string | null; saidAt: Date }

// The first rec in others that is the same item said at the same moment as rec, if any.
export function sameMoment<T extends MomentRec>(rec: MomentRec, others: readonly T[]): T | undefined {
  const who = rec.firstName?.toLowerCase() ?? null;
  return others.find((o) =>
    Math.abs(o.saidAt.getTime() - rec.saidAt.getTime()) <= SAME_MOMENT_MS &&
    (sameName(o.name, rec.name) || (who !== null && o.firstName?.toLowerCase() === who && o.type === rec.type)));
}
