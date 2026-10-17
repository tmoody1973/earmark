"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { consentAction, indexableAction, publishAction, unpublishAction } from "./actions";

interface Props {
  spaceId: number;
  url: string | null;
  published: boolean;
  indexable: boolean;
  people: Array<{ id: number; firstName: string; consent: boolean; tips: number }>;
}

/* Publish / unpublish, the live URL (as text, with Copy), the indexing toggle, and the "said yes to being named" toggles.
   Every result is announced in one live region. Failures log the error name only. */
export function PublishPanel({ spaceId, url, published, indexable, people }: Props) {
  const router = useRouter();
  const [said, setSaid] = useState("");
  const [pending, start] = useTransition();

  const run = (what: string, work: () => Promise<string>) => {
    setSaid("");
    start(async () => {
      try {
        setSaid(await work());
        router.refresh();
      } catch (err) {
        console.error(`${what} failed`, (err as Error).name);
        setSaid("That didn’t save. Try again.");
      }
    });
  };

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setSaid("Link copied.");
    } catch {
      setSaid("Couldn’t copy. Select the link above and copy it.");
    }
  }

  return (
    <div>
      <p role="status" className="r-status">{said}</p>

      <section aria-labelledby="pub-link">
        <h2 id="pub-link">{published ? "This Space is live" : "Not published"}</h2>
        {published ? (
          <>
            {url ? <p className="r-meta" data-testid="publish-url"><code>{url}</code></p> : <p className="r-meta">Set EARMARK_PUBLIC_BASE_URL to show the full link.</p>}
            <p style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              {url && <button type="button" onClick={copy}>Copy link</button>}
              <button
                type="button"
                className="quiet"
                disabled={pending}
                onClick={() => run("unpublish", async () => ((await unpublishAction(spaceId)).changed ? "Unpublished. The old link no longer works." : "Already unpublished."))}
              >
                Unpublish
              </button>
            </p>
          </>
        ) : (
          <p>
            <button type="button" disabled={pending} onClick={() => run("publish", async () => ((await publishAction(spaceId)).published ? "Published." : "Couldn’t publish."))}>
              Publish this Space
            </button>
          </p>
        )}
      </section>

      <section aria-labelledby="pub-index">
        <h2 id="pub-index">Search engines</h2>
        <p className="r-meta">Off by default: the page asks search engines not to list it. People with the link can still open it.</p>
        <label style={{ display: "flex", alignItems: "center", gap: "0.75rem", minHeight: 44 }}>
          <input
            type="checkbox"
            checked={indexable}
            disabled={pending}
            style={{ width: 24, height: 24 }}
            onChange={(e) => run("indexing", async () => {
              await indexableAction(spaceId, e.target.checked);
              return e.target.checked ? "Search engines may list this page." : "Search engines are asked not to list this page.";
            })}
          />
          Let search engines list this page
        </label>
      </section>

      <section aria-labelledby="pub-names">
        <h2 id="pub-names">Who is named</h2>
        <p className="r-meta">Only kept tips appear publicly. A first name shows under a tip only after you check “They said yes to being named” for that person, which you should do only once they have told you so.</p>
        {people.length === 0 ? (
          <p className="r-meta">No kept tip has a recommender yet.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {people.map((p) => (
              <li key={p.id}>
                <label style={{ display: "flex", alignItems: "center", gap: "0.75rem", minHeight: 44 }}>
                  <input
                    type="checkbox"
                    checked={p.consent}
                    disabled={pending}
                    style={{ width: 24, height: 24 }}
                    onChange={(e) => run("consent", async () => {
                      await consentAction(spaceId, p.id, e.target.checked);
                      return e.target.checked ? `${p.firstName} will be named.` : `${p.firstName} will not be named.`;
                    })}
                  />
                  <span>{p.firstName} ({p.tips} {p.tips === 1 ? "tip" : "tips"}): They said yes to being named</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
