'use client';

import type { ChatMessage } from '@coal/shared';
import { ExternalLink, Globe } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { WebLink } from '@/components/chat/web-lookup';

const TYPES = [
  'project',
  'task',
  'document',
  'deviation',
  'timeline',
  'template',
  'person',
  'widget',
  'sample',
  'attachment',
  'source',
] as const;
const isKnownType = (type: string): type is (typeof TYPES)[number] =>
  (TYPES as readonly string[]).includes(type);

/**
 * The right-hand pane: the records the selected reply rests on, with the passage each gave, and
 * what the assistant looked at (docs/workstation-and-ai.md#the-workstation).
 */
export function SourcesPane({
  message,
  preview,
}: {
  message: ChatMessage | undefined;
  /** A PDF to look at (a template's sample, or a draft), shown above the sources. */
  preview?: { title: string; node: ReactNode } | undefined;
}) {
  const t = useTranslations('workstation.sources');
  const citations = (message?.parts ?? []).flatMap((p) => (p.type === 'text' ? p.citations : []));
  const records = citations.filter((c) => c.type !== 'web');
  const fromWeb = citations.filter((c) => c.type === 'web');
  const looked = (message?.parts ?? []).flatMap((p) => (p.type === 'activity' ? p.items : []));

  if (!preview && (!message || (citations.length === 0 && looked.length === 0))) {
    return <p className="text-sm text-muted-foreground">{t('empty')}</p>;
  }
  return (
    <div className="grid gap-5">
      {preview && (
        <section className="grid gap-2">
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {t('preview')}
          </h3>
          <p className="text-sm font-medium">{preview.title}</p>
          {preview.node}
        </section>
      )}
      <section className="grid gap-2">
        <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {t('title')}
        </h3>
        {records.length === 0 && fromWeb.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('none')}</p>
        ) : records.length > 0 ? (
          <ol className="grid gap-2">
            {records.map((c) => (
              <li key={c.ref} className="grid gap-1 rounded-lg border p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <span className="flex items-start gap-2">
                    <span className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground">
                      {c.ref.slice(1)}
                    </span>
                    <span className="font-medium">{c.label}</span>
                  </span>
                  {c.link && (
                    <Link
                      href={c.link}
                      className="shrink-0 text-muted-foreground hover:text-foreground"
                      aria-label={t('open', { label: c.label })}
                    >
                      <ExternalLink className="size-3.5" aria-hidden />
                    </Link>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {isKnownType(c.type) ? t(`types.${c.type}`) : c.type}
                </p>
                {c.passage && <p className="text-xs">{c.passage}</p>}
              </li>
            ))}
          </ol>
        ) : null}
      </section>
      {fromWeb.length > 0 && (
        <section className="grid gap-2">
          <h3 className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            <Globe className="size-3.5" aria-hidden />
            {t('fromWeb')}
          </h3>
          <p className="text-xs text-muted-foreground">{t('fromWebNote')}</p>
          <ol className="grid gap-2">
            {fromWeb.map((c) => (
              <li key={c.ref} className="grid gap-1 rounded-lg border p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <span className="flex items-start gap-2">
                    <span className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground ring-1 ring-sky-500/50">
                      {c.ref.slice(1)}
                    </span>
                    <span className="font-medium">{c.label}</span>
                  </span>
                  <WebLink
                    href={c.link}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    label={t('openWeb', { label: c.label })}
                  >
                    <ExternalLink className="size-3.5" aria-hidden />
                  </WebLink>
                </div>
                {c.passage && <p className="text-xs text-muted-foreground">{c.passage}</p>}
              </li>
            ))}
          </ol>
        </section>
      )}
      {looked.length > 0 && (
        <section className="grid gap-2">
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {t('looked')}
          </h3>
          <ul className="grid gap-0.5 text-xs text-muted-foreground">
            {looked.map((item, i) => (
              <li key={i}>{item.label}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
