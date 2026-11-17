import React from "react";

// Minimal markdown renderer for AI chat replies: headings, **bold**, *italic*,
// bullet and numbered lists, GFM tables, paragraphs. Renders React elements, so
// no HTML injection risk.
// ponytail: still a subset; swap for react-markdown + remark-gfm if replies get richer
function inline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  // Bold first; then italics within the remaining (non-bold) segments.
  text.split(/\*\*(.+?)\*\*/g).forEach((part, i) => {
    if (i % 2 === 1) {
      out.push(<strong key={"b" + i}>{part}</strong>);
    } else {
      part.split(/\*(.+?)\*/g).forEach((p, j) =>
        out.push(j % 2 === 1 ? <em key={"i" + i + "-" + j}>{p}</em> : p)
      );
    }
  });
  return out;
}

// A GFM separator row: | --- | :--: | etc.
function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line);
}

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

export default function Markdown({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  let listItems: React.ReactNode[] = [];

  const flushList = () => {
    if (listItems.length > 0) {
      blocks.push(
        <ul key={"ul-" + blocks.length} className="list-disc pl-4 space-y-1">
          {listItems}
        </ul>
      );
      listItems = [];
    }
  };

  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // GFM table: header row, separator row, then body rows.
    if (trimmed.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      flushList();
      const header = splitRow(trimmed);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && lines[j].includes("|") && lines[j].trim()) {
        rows.push(splitRow(lines[j]));
        j++;
      }
      blocks.push(
        <div key={"t-" + i} className="overflow-x-auto my-1.5">
          <table className="text-[13px] border-collapse">
            <thead>
              <tr>
                {header.map((h, k) => (
                  <th
                    key={k}
                    className="border border-border px-2 py-1 text-left font-semibold bg-secondary/60"
                  >
                    {inline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, ci) => (
                    <td key={ci} className="border border-border px-2 py-1 align-top">
                      {inline(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      i = j - 1;
      continue;
    }

    if (!trimmed) {
      flushList();
      continue;
    }

    const heading = trimmed.match(/^#{1,6}\s+(.*)/);
    const bullet = trimmed.match(/^[*-]\s+(.*)/);
    const numbered = trimmed.match(/^(\d+[.)])\s+(.*)/);

    if (heading) {
      flushList();
      blocks.push(
        <p key={i} className="font-bold mt-1">
          {inline(heading[1])}
        </p>
      );
    } else if (bullet) {
      listItems.push(<li key={i}>{inline(bullet[1])}</li>);
    } else if (numbered) {
      flushList();
      blocks.push(
        <p key={i}>
          <strong>{numbered[1]}</strong> {inline(numbered[2])}
        </p>
      );
    } else {
      flushList();
      blocks.push(<p key={i}>{inline(trimmed)}</p>);
    }
  }
  flushList();

  return <div className="space-y-1.5">{blocks}</div>;
}
