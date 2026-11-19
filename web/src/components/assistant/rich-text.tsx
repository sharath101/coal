import { Fragment, type ReactNode } from 'react';

/**
 * Shows the assistant's replies: paragraphs, headings, lists, simple tables, **bold** and `code`.
 * Links and images are not shown (docs/workstation-and-ai.md#safety-basics).
 */

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const token = match[0];
    out.push(
      token.startsWith('**') ? (
        <strong key={at}>{token.slice(2, -2)}</strong>
      ) : (
        <code key={at} className="rounded bg-muted px-1 py-0.5 text-[0.85em]">
          {token.slice(1, -1)}
        </code>
      ),
    );
    last = at + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (row: string) =>
  row
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());

function block(lines: string[], key: number): ReactNode {
  const first = lines[0] ?? '';
  if (lines.every((l) => l.trim().startsWith('|'))) {
    const rows = lines.filter((l) => !/^\s*\|?\s*:?-{2,}/.test(l)).map(cells);
    const [head, ...body] = rows;
    return (
      <div key={key} className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              {head?.map((c, i) => (
                <th key={i} className="border-b px-2 py-1 text-left font-medium">
                  {inline(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j} className="border-b px-2 py-1 align-top">
                    {inline(c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
    return (
      <ul key={key} className="list-disc pl-5">
        {lines.map((l, i) => (
          <li key={i}>{inline(l.replace(/^\s*[-*•]\s+/, ''))}</li>
        ))}
      </ul>
    );
  }
  if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) {
    return (
      <ol key={key} className="list-decimal pl-5">
        {lines.map((l, i) => (
          <li key={i}>{inline(l.replace(/^\s*\d+[.)]\s+/, ''))}</li>
        ))}
      </ol>
    );
  }
  if (lines.length === 1 && /^#{1,4}\s/.test(first)) {
    return (
      <p key={key} className="font-semibold">
        {inline(first.replace(/^#{1,4}\s+/, ''))}
      </p>
    );
  }
  return (
    <p key={key}>
      {lines.map((l, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          {inline(l.replace(/^#{1,4}\s+/, ''))}
        </Fragment>
      ))}
    </p>
  );
}

/** Splits into blocks at blank lines, and where a list or table starts or ends. */
export function RichText({ text }: { text: string }) {
  const blocks: string[][] = [];
  let current: string[] = [];
  const kind = (l: string) =>
    l.trim().startsWith('|')
      ? 'table'
      : /^\s*([-*•]|\d+[.)])\s+/.test(l)
        ? 'list'
        : /^#{1,4}\s/.test(l)
          ? 'heading'
          : 'text';
  for (const line of text.split('\n')) {
    if (!line.trim()) {
      if (current.length) blocks.push(current);
      current = [];
      continue;
    }
    const k = kind(line);
    if (current.length && (k !== kind(current[0]!) || k === 'heading')) {
      blocks.push(current);
      current = [];
    }
    current.push(line);
  }
  if (current.length) blocks.push(current);
  return <div className="grid gap-2 text-sm leading-relaxed">{blocks.map(block)}</div>;
}
