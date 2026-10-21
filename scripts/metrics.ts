// M6-T7: real-use numbers against the PRD success metrics. READ-ONLY (selects only), self-contained (no app imports).
// Run: node --env-file=.env.local scripts/metrics.ts   (Node 24+ runs .ts natively)
// Output is counts and percentages only. The repo is public: never print tip names, excerpts, people or speech.
import { readFileSync, writeFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (run with --env-file=.env.local)");
const sql = neon(url);

const pct = (n: number, d: number) => (d === 0 ? "n/a (no rows)" : `${((100 * n) / d).toFixed(1)}% (${n}/${d})`);
const met = (ok: boolean) => (ok ? "Yes" : "No");
const p1 = (x: number) => `${(100 * x).toFixed(1)}%`;

// Tips Earmark has decided on: not waiting in the review pile (needs_review) and not an unclaimed overheard tip.
const [recs] = await sql`
  select count(*)::int as total,
         count(*) filter (where status = 'dismissed')::int as dismissed,
         count(*) filter (where status = 'dismissed' and user_verdict = 'not_a_tip')::int as dismissed_by_owner,
         count(*) filter (where status = 'dismissed' and user_verdict is null)::int as dismissed_by_system
  from recommendations where status not in ('needs_review', 'overheard')`;
// Cross-check the denominator a second way: sum of per-status counts.
const byStatus = await sql`select status, count(*)::int as n from recommendations group by status`;
const crossTotal = byStatus.filter((r) => r.status !== "needs_review" && r.status !== "overheard").reduce((s, r) => s + Number(r.n), 0);
if (crossTotal !== recs.total) throw new Error(`denominator mismatch: ${recs.total} vs ${crossTotal}`);

const [ideas] = await sql`
  select count(*)::int as total,
         count(*) filter (where review_status = 'dismissed')::int as dismissed
  from idea_mentions where review_status <> 'needs_review'`;
const [pile] = await sql`
  select (select count(*)::int from recommendations where status = 'needs_review') as tips_waiting,
         (select count(*)::int from idea_mentions where review_status = 'needs_review') as ideas_waiting`;

// Enrichment: matched over tips that went through enrichment (matched or no_match), among tips still standing.
const [enr] = await sql`
  select count(*) filter (where enrichment_status = 'matched')::int as matched,
         count(*) filter (where enrichment_status in ('matched', 'no_match'))::int as done
  from recommendations where status not in ('dismissed', 'composted', 'needs_review', 'overheard')`;

const [vol] = await sql`
  select (select count(*)::int from processed_conversations) as conversations,
         (select count(*)::int from idea_clusters) as clusters,
         (select count(*)::int from idea_clusters where stage in ('ready', 'drafted', 'used')) as bloomed,
         (select count(*)::int from episodes where published_at is not null) as episodes,
         (select min(created_at)::date::text from recommendations) as first_item`;

const report = JSON.parse(readFileSync("evals/triage/reports/latest.json", "utf8"));
const m = report.models[report.triageModel];
const evalRef = `evals/triage/reports/latest.json, ${report.date}, n=${m.n}, ${report.triageModel}`;

const today = new Date().toISOString().slice(0, 10);
const md = `# Earmark real-use metrics — ${today}

Source: Neon production store (SELECT only), queried by \`scripts/metrics.ts\`; first item stored ${vol.first_item ?? "none"}.
Run: \`node --env-file=.env.local scripts/metrics.ts\`. Counts and percentages only.

| PRD metric | Target | Measured | Met? |
|---|---|---|---|
| Tips dismissed as "not a tip" (of tips decided, i.e. not waiting in review or overheard) | < 20% | ${pct(recs.dismissed, recs.total)}; ${recs.dismissed_by_owner} with a Not-a-tip verdict, ${recs.dismissed_by_system} without one | ${met(recs.dismissed < 0.2 * recs.total)} |
| Idea mentions dismissed as "not an idea" (of mentions decided, i.e. not waiting in review) | < 20% | ${pct(ideas.dismissed, ideas.total)} | ${met(ideas.dismissed < 0.2 * ideas.total)} |
| Tip enrichment match (matched / tips that finished enrichment as matched or no_match; tips still standing, dismissed excluded) | ≥ 80% | ${pct(enr.matched, enr.done)} | ${met(enr.matched >= 0.8 * enr.done)} |
| Store → Notion latency | < 2 min | n/a — Notion sync is not built (the push is a TODO in the tip lane; there is no sync table), so nothing was measured | n/a |
| Weekly episodes generated | 4 of 4 Sundays | ${vol.episodes} of 4 published | ${met(vol.episodes >= 4)} |
| Tip detection precision (labeled set; ${evalRef}) | ≥ 85% | ${p1(m.recPrecision)} | ${met(m.recPrecision >= 0.85)} |
| Idea detection precision (labeled set; same report) | ≥ 75% | ${p1(m.ideaPrecision)} | ${met(m.ideaPrecision >= 0.75)} |

Volume: ${vol.conversations} conversations processed, ${vol.clusters} idea clusters, ${vol.bloomed} bloomed (ready or later). Still waiting in review, excluded above: ${pile.tips_waiting} tips, ${pile.ideas_waiting} idea mentions.

How to read this:
- Dismissal rates are a real-use proxy for precision (a kept item can still be wrong). A Not-a-tip verdict is the owner's Keep / Not a tip choice on the Maybe? pile; dismissals without one were not marked there, so they may be triage drops or dismissals from another surface (not separated here).
- Review-pile items are excluded from the denominators because no one has decided them yet, so these rates cover only decided items and would move as the pile is cleared.
- The precision rows come from the 2026-10-19 eval on a 48-item labeled set, one model; they are not real-use numbers.
`;
const out = `docs/metrics-${today}.md`;
writeFileSync(out, md);
console.log(`wrote ${out}`);
