import { draftBlocks, inlineRuns } from "@/agent/lib/garden/draft";

// Inside the page the idea's title is the h1 and "The one-pager" the h2, so the draft's own levels start at h3.
const HEADING = { 1: "h3", 2: "h4", 3: "h5" } as const;

function Inline({ text }: { text: string }) {
  return inlineRuns(text).map((r, i) => (r.bold ? <strong key={i}>{r.text}</strong> : <span key={i}>{r.text}</span>));
}

/** The one-pager in reading mode: rendered from markdown blocks as React elements, never as injected HTML. */
export function Draft({ md }: { md: string }) {
  return (
    <div className="draft">
      {draftBlocks(md).map((b, i) => {
        if (b.kind === "h") {
          const Tag = HEADING[b.level];
          return <Tag key={i}><Inline text={b.text} /></Tag>;
        }
        if (b.kind === "p") {
          // The code-written first line ("Mentioned 3 times: …") is metadata, set quieter than the prose.
          const dates = i === 0 && /^Mentioned \d+ times?:/.test(b.text);
          return <p key={i} className={dates ? "draft-dates" : undefined}><Inline text={b.text} /></p>;
        }
        const List = b.kind;
        return <List key={i}>{b.items.map((t, j) => <li key={j}><Inline text={t} /></li>)}</List>;
      })}
    </div>
  );
}
