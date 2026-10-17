import { experimental_decide, generateText, Output } from "ai";
import { z } from "zod";
import { createBeeClient, type BeeClient } from "../bee/client";
import { db } from "../db";
import { getEnv } from "../env";
import { TIMELINE_TZ } from "../ideas/timeline-format";
import { nameAppearsIn } from "../pipeline/attribution";

// FR-19: Earmark proposes facts about the owner's taste and ideas. Each one goes to Bee as an UNCONFIRMED fact; the owner
// confirms or deletes it in the Bee app, and the 10-minute changes sync mirrors that back (handleFactChange).
const MIN_EVIDENCE = 3; // PRD: three or more loved recs share a pattern
const FIT_THRESHOLD = 0.7;
const ABOUT_USER_THRESHOLD = 0.8;
const MAX_ITEMS = 20; // Jev: keep state short

const Statements = z.object({ statements: z.array(z.string().min(5).max(80)).max(5) });

interface ProposeDeps { generateImpl: typeof generateText; decideImpl: typeof experimental_decide }

export async function proposeTasteFacts(
  { generateImpl, decideImpl }: ProposeDeps = { generateImpl: generateText, decideImpl: experimental_decide },
): Promise<string[]> {
  const loved = (await db()`
    select id, type, canonical_name, creator from recommendations
    where rating = 'loved' order by updated_at desc limit ${MAX_ITEMS}`) as { id: number; type: string; canonical_name: string; creator: string | null }[];
  if (loved.length < MIN_EVIDENCE) return [];
  const names = ((await db()`select first_name from recommenders`) as { first_name: string }[]).map((r) => r.first_name);
  const existing = new Set(((await db()`select lower(text) as t from fact_proposals`) as { t: string }[]).map((r) => r.t));

  const label = (r: (typeof loved)[number]) => `${r.canonical_name}${r.creator ? ` by ${r.creator}` : ""} (${r.type})`;
  const { output } = await generateImpl({
    model: getEnv().WRITE_MODEL,
    output: Output.object({ schema: Statements }),
    prompt: `These are things the user tried and loved:\n${loved.map(label).join("\n")}\n\nPropose up to 5 short statements about the user's own taste that several of these items share. Each starts with "Loves" or "Enjoys", names a genre, cuisine, style or mood (never a single title), and never mentions any other person.`,
  });

  const kept: string[] = [];
  const items = Object.fromEntries(loved.map((r) => [`i_${r.id}`, label(r)]));
  for (const statement of output.statements) {
    if (existing.has(statement.toLowerCase())) continue;
    if (names.some((n) => nameAppearsIn(n, statement))) continue; // facts are about the owner only
    const fits = await decideImpl({
      model: getEnv().TRIAGE_MODEL,
      state: { taste: statement, items },
      questions: Object.fromEntries(
        loved.map((r) => [`fits_i_${r.id}`, { type: "boolean" as const, instructions: `Does item \`i_${r.id}\` in \`items\` fit the taste described in \`taste\`?` }]),
      ),
    });
    const evidence = loved.filter((r) => {
      const a = fits.answers[`fits_i_${r.id}`];
      return a?.type === "boolean" && a.probability >= FIT_THRESHOLD;
    });
    if (evidence.length < MIN_EVIDENCE) continue; // counting is code's job, not Jev's
    const about = await decideImpl({
      model: getEnv().TRIAGE_MODEL,
      state: { statement },
      questions: {
        about_user: {
          type: "boolean",
          instructions: "Is `statement` only about the listener's own taste, with no other person named or described?",
        },
      },
    });
    const p = about.answers.about_user;
    if (p?.type !== "boolean" || p.probability < ABOUT_USER_THRESHOLD) continue;
    await db()`
      insert into fact_proposals (text, kind, evidence_ids)
      values (${statement}, 'taste', ${JSON.stringify(evidence.map((r) => Number(r.id)))}::jsonb)`;
    existing.add(statement.toLowerCase());
    kept.push(statement);
  }
  return kept;
}

/** Ready ideas become fact proposals; the text is built in code (counts and dates are never Jev's job). */
export async function proposeIdeaFacts(): Promise<number> {
  const rows = (await db()`
    select c.id, c.title, c.mention_count, c.first_mentioned_at from idea_clusters c
    where c.stage in ('ready', 'drafted') and c.bee_fact_id is null
      and not exists (select 1 from fact_proposals f where f.kind = 'idea' and f.evidence_ids @> to_jsonb(array[c.id]))`) as {
    id: number; title: string; mention_count: number; first_mentioned_at: string;
  }[];
  for (const c of rows) {
    const since = new Date(c.first_mentioned_at).toLocaleString("en-US", { month: "short", timeZone: TIMELINE_TZ });
    const text = `Developing an idea: ${c.title} (mentioned ${c.mention_count} times since ${since})`.slice(0, 2000);
    await db()`insert into fact_proposals (text, kind, evidence_ids) values (${text}, 'idea', ${JSON.stringify([Number(c.id)])}::jsonb)`;
  }
  return rows.length;
}

/** Writes pending proposals to Bee as unconfirmed facts and records the ids in bee_sync. */
export async function writePendingProposals(bee: BeeClient = createBeeClient()): Promise<number> {
  const pending = (await db()`select id, text from fact_proposals where status = 'pending' and bee_fact_id is null`) as { id: number; text: string }[];
  for (const p of pending) {
    const { id: beeId } = await bee.createFact(p.text);
    await db()`update fact_proposals set bee_fact_id = ${beeId} where id = ${p.id}`;
    await db()`
      insert into bee_sync (entity_type, entity_id, bee_object, bee_id, last_written_state)
      values ('fact_proposal', ${p.id}, 'fact', ${beeId}, ${JSON.stringify({ confirmed: false })}::jsonb)
      on conflict (entity_type, entity_id, bee_object) do update set bee_id = excluded.bee_id, last_synced_at = now()`;
  }
  return pending.length;
}
