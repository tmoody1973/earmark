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

// Exact equality after normalizing (no containment): for checks that span a whole conversation, where containment
// ("Shogun" in "Shogun on Hulu") is too loose; containment is only trusted inside the ±60 s window below.
export function sameNormalizedName(a: string, b: string): boolean {
  const x = normalizeName(a);
  return x !== "" && x === normalizeName(b);
}

// deliberate: a spoken "Earmark that" (a voice note, or one said in a conversation); false for an ambient rec.
export interface MomentRec { name: string; type: string; firstName: string | null; saidAt: Date; deliberate: boolean }

const within = (a: MomentRec, b: MomentRec) => Math.abs(a.saidAt.getTime() - b.saidAt.getTime()) <= SAME_MOMENT_MS;
const sameWho = (a: MomentRec, b: MomentRec) =>
  a.firstName !== null && b.firstName !== null && a.firstName.toLowerCase() === b.firstName.toLowerCase() && a.type === b.type;

// One-to-one pairing of recs with the other source's recs said at the same moment (±60 s). Each other rec pairs at
// most once. Pass 1: same name, for every rec. Pass 2, only for recs still unpaired and only between two deliberate
// earmarks: same recommender first name + same type (a cut-off note re-said with a different title). In each pass,
// recs are taken in the given order and each takes its nearest-in-time free candidate (ties: the given order).
// Result[i] is the rec that recs[i] repeats, or undefined.
export function pairSameMoment<T extends MomentRec>(recs: readonly MomentRec[], others: readonly T[]): (T | undefined)[] {
  const used = new Set<T>();
  const out: (T | undefined)[] = recs.map(() => undefined);
  const pass = (ok: (r: MomentRec, o: T) => boolean) => recs.forEach((r, i) => {
    if (out[i]) return;
    const free = others.filter((o) => !used.has(o) && within(r, o) && ok(r, o));
    const best = free.reduce<T | undefined>((b, o) =>
      !b || Math.abs(o.saidAt.getTime() - r.saidAt.getTime()) < Math.abs(b.saidAt.getTime() - r.saidAt.getTime()) ? o : b, undefined);
    if (best) { used.add(best); out[i] = best; }
  });
  pass((r, o) => sameName(r.name, o.name));
  pass((r, o) => r.deliberate && o.deliberate && sameWho(r, o));
  return out;
}

// One rec against the other source (a voice note checking the conversation recs said around it).
export const sameMoment = <T extends MomentRec>(rec: MomentRec, others: readonly T[]): T | undefined => pairSameMoment([rec], others)[0];
