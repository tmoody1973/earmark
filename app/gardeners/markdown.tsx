import { Fragment, type ReactNode } from "react";

// Tiny, safe Markdown -> React elements. Only text nodes and a fixed set of tags are ever produced, so
// model output can never inject HTML (React escapes every string). Links must be https.
// Supported: #/##/### headings, paragraphs, **bold**, *italic*, `code`, -/* and 1. lists, [text](https://...).

const INLINE = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

const isHttps = (u: string) => URL.canParse(u) && new URL(u).protocol === "https:";

function inline(text: string, key = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${n++}`;
    if (m[1] !== undefined) out.push(<code key={k}>{m[1]}</code>);
    else if (m[2] !== undefined) out.push(<strong key={k}>{inline(m[2], k)}</strong>);
    else if (m[3] !== undefined) out.push(<em key={k}>{inline(m[3], k)}</em>);
    else if (isHttps(m[5])) out.push(<a key={k} href={m[5]} rel="noopener noreferrer" target="_blank">{m[4]}</a>);
    else out.push(m[0]); // non-https link stays literal text
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out.map((c, i) => (typeof c === "string" ? <Fragment key={`${key}-t${i}`}>{c}</Fragment> : c));
}

const HEADING = /^(#{1,3})\s+(.*)$/;
const BULLET = /^\s*[-*]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const key = `b${blocks.length}`;
    const h = HEADING.exec(line);
    const list = BULLET.test(line) ? BULLET : NUMBERED.test(line) ? NUMBERED : null;
    if (!line.trim()) { i++; continue; }
    if (h) {
      const Tag = (["h3", "h4", "h5"] as const)[h[1].length - 1]; // page h3 is the draft title; keep the hierarchy under it
      blocks.push(<Tag key={key}>{inline(h[2], key)}</Tag>);
      i++;
    } else if (list) {
      const items: ReactNode[] = [];
      while (i < lines.length && list.test(lines[i])) {
        items.push(<li key={`${key}-${items.length}`}>{inline(list.exec(lines[i])![1], `${key}-${items.length}`)}</li>);
        i++;
      }
      blocks.push(list === BULLET ? <ul key={key}>{items}</ul> : <ol key={key}>{items}</ol>);
    } else {
      const para: string[] = [];
      while (i < lines.length && lines[i].trim() && !HEADING.test(lines[i]) && !BULLET.test(lines[i]) && !NUMBERED.test(lines[i])) para.push(lines[i++]);
      blocks.push(<p key={key}>{inline(para.join(" "), key)}</p>);
    }
  }
  return <div className="g-md">{blocks}</div>;
}
