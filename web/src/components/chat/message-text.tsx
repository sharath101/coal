'use client';

import type { Citation } from '@coal/shared';
import { Globe } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { WebLink } from '@/components/chat/web-lookup';
import { cn } from '@/lib/utils';

const TAG = /(\[S\d+\])/;
const BOLD = /(\*\*[^*\n]+\*\*)/;

/**
 * A citation: a small numbered mark that shows the record and its passage on hover and opens it on
 * click. A page from the web opens in a new tab, and says it is from the web.
 */
function CitationMark({ citation, onSelect }: { citation: Citation; onSelect?: () => void }) {
  const t = useTranslations('workstation.sources');
  const web = citation.type === 'web';
  const mark = cn(
    'inline-flex size-4 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground',
    citation.link && 'hover:bg-primary hover:text-primary-foreground',
    web && 'ring-1 ring-sky-500/50',
  );
  const number = citation.ref.slice(1);
  return (
    <span className="group relative mx-0.5 inline-block align-text-top">
      {web ? (
        <WebLink
          href={citation.link}
          className={mark}
          label={t('openWeb', { label: citation.label })}
        >
          {number}
        </WebLink>
      ) : citation.link ? (
        <Link href={citation.link} className={mark} onClick={onSelect} aria-label={citation.label}>
          {number}
        </Link>
      ) : (
        <button type="button" className={mark} onClick={onSelect} aria-label={citation.label}>
          {number}
        </button>
      )}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 hidden w-64 -translate-x-1/2 rounded-md border bg-popover p-2 text-xs text-popover-foreground shadow-md group-focus-within:block group-hover:block"
      >
        {web && (
          <span className="mb-1 flex items-center gap-1 text-muted-foreground">
            <Globe className="size-3" aria-hidden />
            {t('fromWeb')}
          </span>
        )}
        <span className="block font-medium">{citation.label}</span>
        {citation.passage && (
          <span className="mt-1 block text-muted-foreground">{citation.passage}</span>
        )}
      </span>
    </span>
  );
}

/** One run of words: citation tags become marks. */
function Words({
  line,
  citations,
  streaming,
  onSelect,
}: {
  line: string;
  citations: Map<string, Citation>;
  streaming: boolean;
  onSelect?: (citation: Citation) => void;
}) {
  return line.split(TAG).map((piece, i) => {
    const match = /^\[(S\d+)\]$/.exec(piece);
    if (!match) return piece;
    const citation = citations.get(match[1] as string);
    if (citation) {
      return <CitationMark key={i} citation={citation} onSelect={() => onSelect?.(citation)} />;
    }
    // While the reply is being written its tags aren't matched to records yet.
    return streaming ? (
      <sup key={i} className="mx-0.5 text-[10px] text-muted-foreground/60">
        {(match[1] as string).slice(1)}
      </sup>
    ) : null;
  });
}

/**
 * A line of a reply. The assistant is told to write plain text, but some models bold a lead-in
 * anyway ("**Signing:** …"); that is shown as bold rather than as stray asterisks.
 */
function Line(props: {
  line: string;
  citations: Map<string, Citation>;
  streaming: boolean;
  onSelect?: (citation: Citation) => void;
}) {
  return props.line.split(BOLD).map((piece, i) => {
    const bold = /^\*\*([^*\n]+)\*\*$/.exec(piece);
    return bold ? (
      <strong key={i} className="font-semibold">
        <Words {...props} line={bold[1] as string} />
      </strong>
    ) : (
      <Words key={i} {...props} line={piece} />
    );
  });
}

/**
 * The words of a reply: paragraphs, "- " lists, and citation marks in place of the `[S1]` tags
 * (docs/workstation-and-ai.md#citations). The assistant writes plain text, so this is all it needs.
 */
export function MessageText({
  text,
  citations = [],
  streaming = false,
  onSelect,
}: {
  text: string;
  citations?: Citation[];
  streaming?: boolean;
  onSelect?: (citation: Citation) => void;
}) {
  const byRef = new Map(citations.map((c) => [c.ref, c]));
  const blocks = text.split(/\n{2,}/).filter((b) => b.trim());
  const line = (value: string) => (
    <Line line={value} citations={byRef} streaming={streaming} onSelect={onSelect} />
  );
  return (
    <div className="grid gap-2 text-sm leading-relaxed">
      {blocks.map((block, i) => {
        // Runs of "- " lines are lists; the lines around them are paragraphs.
        const parts: { list: boolean; lines: string[] }[] = [];
        for (const raw of block.split('\n')) {
          const list = /^\s*-\s+/.test(raw);
          const last = parts.at(-1);
          const text = list ? raw.replace(/^\s*-\s+/, '') : raw;
          if (last && last.list === list) last.lines.push(text);
          else parts.push({ list, lines: [text] });
        }
        return parts.map((part, j) =>
          part.list ? (
            <ul key={`${i}-${j}`} className="grid list-disc gap-1 pl-5">
              {part.lines.map((item, k) => (
                <li key={k}>{line(item)}</li>
              ))}
            </ul>
          ) : (
            <p key={`${i}-${j}`} className="whitespace-pre-line">
              {line(part.lines.join('\n'))}
            </p>
          ),
        );
      })}
    </div>
  );
}
