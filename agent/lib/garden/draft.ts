// The one-pager (M2-T7) is markdown with headings, paragraphs, bullet and numbered lists, and **bold**. This reads
// exactly that into blocks the page renders as React elements, so no HTML string is ever injected.
// ponytail: no markdown library; switch to one if drafts start using links, tables or nested lists.

export type DraftBlock =
  | { kind: "h"; level: 1 | 2 | 3; text: string }
  | { kind: "p"; text: string }
  | { kind: "ul" | "ol"; items: string[] };

const HEADING = /^(#{1,3})\s+(.*)$/;
const BULLET = /^[-*]\s+(.*)$/;
const NUMBERED = /^\d+[.)]\s+(.*)$/;

export function draftBlocks(md: string): DraftBlock[] {
  const blocks: DraftBlock[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: "p", text: para.join(" ") });
    para = [];
  };
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    const h = HEADING.exec(line);
    const item = BULLET.exec(line) ?? NUMBERED.exec(line);
    if (!line) flush();
    else if (h) {
      flush();
      blocks.push({ kind: "h", level: h[1]!.length as 1 | 2 | 3, text: h[2]! });
    } else if (item) {
      flush();
      const kind = BULLET.test(line) ? "ul" : "ol";
      const last = blocks.at(-1);
      if (last && last.kind === kind) last.items.push(item[1]!);
      else blocks.push({ kind, items: [item[1]!] });
    } else para.push(line);
  }
  flush();
  return blocks;
}

export function inlineRuns(text: string): Array<{ bold: boolean; text: string }> {
  return text
    .split(/\*\*(.+?)\*\*/)
    .map((t, i) => ({ bold: i % 2 === 1, text: t }))
    .filter((r) => r.text !== "");
}
