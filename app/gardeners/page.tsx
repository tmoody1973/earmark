import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/agent/lib/db";
import { isOwner } from "@/agent/lib/owner";
import { createGardener, runNow, setGardenerEnabled, setRunStatus } from "./actions";
import { Markdown } from "./markdown";
import "./gardeners.css";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // "Run now" on the episode gardener writes, voices and uploads in one action
export const metadata: Metadata = { title: "Gardeners · Earmark" };

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const when = (iso: string) => new Date(iso).toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric" });

interface GardenerRow { id: number | string; name: string; kind: string; task: string; last_run_at: string | null; enabled: boolean }
interface RunRow { id: number | string; output_md: string; status: string; created_at: string; name: string; kind: string }

export default async function GardenersPage() {
  const { userId } = await auth();
  if (!isOwner(userId)) notFound();
  const gardeners = (await db()`select id, name, kind, task, last_run_at, enabled from gardeners order by id`) as GardenerRow[];
  const runs = (await db()`
    select r.id, r.output_md, r.status, r.created_at, g.name, g.kind
    from gardener_runs r join gardeners g on g.id = r.gardener_id
    order by (r.status = 'draft') desc, r.created_at desc limit 20`) as RunRow[];
  return (
    <main className="gardeners">
      <p><Link className="g-back" href="/garden">Back to the garden</Link></p>
      <h1>Gardeners</h1>
      <p className="lede">Helpers that tend the garden on a schedule. Nothing leaves Earmark; every result waits here as a draft until you approve it.</p>
      <p className="lede">New to gardeners? <a href="https://github.com/tmoody1973/earmark/blob/main/docs/gardener-guide.md" rel="noopener noreferrer" target="_blank">Read the guide, with examples</a>.</p>

      <section aria-labelledby="g-list">
        <h2 id="g-list">Planted</h2>
        <ul className="g-list">
          {gardeners.map((g) => (
            <li key={g.id}>
              <strong>{g.name}</strong>
              <span className="g-task">{g.task}</span>
              <span className="g-meta">{g.last_run_at ? `Last ran ${when(g.last_run_at)}` : "Has not run yet"}</span>
              {!g.enabled && <span className="g-meta">Paused</span>}
              <div className="g-actions">
                {g.enabled && <form action={runNow.bind(null, Number(g.id))}><button type="submit">Run now</button></form>}
                <form action={setGardenerEnabled.bind(null, Number(g.id), !g.enabled)}>
                  <button type="submit" className="quiet">{g.enabled ? "Pause" : "Resume"}</button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="g-drafts">
        <h2 id="g-drafts">Drafts</h2>
        {runs.length === 0 && <p className="g-meta">Nothing yet.</p>}
        {runs.map((r) => (
          <article key={r.id} className="g-run">
            <h3>{r.name} <span className="g-meta">{when(r.created_at)} · {r.status}</span></h3>
            <Markdown text={r.output_md} />
            {r.status === "draft" && (
              <div className="g-actions">
                <form action={setRunStatus.bind(null, Number(r.id), "approved")}>
                  <button type="submit">{r.kind === "episode" ? "Approve and publish" : "Approve"}</button>
                </form>
                <form action={setRunStatus.bind(null, Number(r.id), "dismissed")}><button type="submit" className="quiet">Dismiss</button></form>
              </div>
            )}
          </article>
        ))}
      </section>

      <section aria-labelledby="g-new">
        <h2 id="g-new">Plant a gardener</h2>
        <form action={createGardener} className="g-form">
          <label>Name <input name="name" required maxLength={60} /></label>
          <label>What should it do?
            <textarea name="task" required minLength={5} maxLength={500} rows={3} placeholder="Turn my ready ideas into Intersection pitches every Friday." />
          </label>
          <label>How often
            <select name="every" defaultValue="week"><option value="week">Weekly</option><option value="month">Monthly</option></select>
          </label>
          <label>Day of the week (weekly)
            <select name="weekday" defaultValue="5">{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select>
          </label>
          <label>Day of the month (monthly, 1 to 27)
            <input name="day" type="number" min={1} max={27} defaultValue={1} />
          </label>
          <label>Hour, Central time (0 to 23)
            <input name="hourLocal" type="number" min={0} max={23} defaultValue={9} required />
          </label>
          <fieldset>
            <legend>It may read</legend>
            <label className="check"><input type="checkbox" name="sources" value="ideas" defaultChecked /> Ideas</label>
            <label className="check"><input type="checkbox" name="sources" value="recs" /> Recommendations</label>
            <label className="check"><input type="checkbox" name="sources" value="recommenders" /> Who recommended what</label>
          </fieldset>
          <label className="check"><input type="checkbox" name="needsApproval" defaultChecked /> Wait for my approval</label>
          <button type="submit">Plant it</button>
        </form>
      </section>
    </main>
  );
}
