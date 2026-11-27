'use client';

import type { ActionDetail, WebRef } from '@coal/shared';
import { Globe } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export const isWebAddress = (url: string) => /^https?:\/\//i.test(url);

/**
 * A page on the public web: it opens in a new tab and is told nothing about COAL (no referrer). Only
 * addresses the web assistant's tools returned get here, and only web addresses are links.
 */
export function WebLink({
  href,
  className,
  label,
  children,
}: {
  href: string;
  className?: string;
  label?: string;
  children: ReactNode;
}) {
  if (!isWebAddress(href)) return <span className={className}>{children}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      referrerPolicy="no-referrer"
      className={className}
      aria-label={label}
    >
      {children}
    </a>
  );
}

/**
 * A look on the web, under the reply (docs/workstation-and-ai.md#looking-things-up-on-the-web):
 * exactly what left COAL, what the web assistant searched for, and the pages it used.
 */
export function WebLookupView({ lookup }: { lookup: WebRef }) {
  const t = useTranslations('workstation.web');
  return (
    <details className="rounded-lg border bg-muted/30 px-3 py-2 text-xs">
      <summary className="cursor-pointer text-muted-foreground select-none">
        <Globe className="mr-1.5 inline size-3.5 align-text-bottom" aria-hidden />
        {t('looked', { question: lookup.question })}
        {lookup.status !== 'done' && (
          <span className="ml-1.5 text-destructive">{t(`status.${lookup.status}`)}</span>
        )}
      </summary>
      <div className="mt-3 grid gap-3">
        <section className="grid gap-1">
          <h4 className="font-medium">{t('sent')}</h4>
          <p className="text-muted-foreground">{t('sentNote')}</p>
          <p>{lookup.question}</p>
          <ul className="grid list-disc gap-0.5 pl-4">
            {lookup.lookFor.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          {lookup.sites.length > 0 && <p>{t('sites', { sites: lookup.sites.join(', ') })}</p>}
        </section>
        <section className="grid gap-1">
          <h4 className="font-medium">{t('searches')}</h4>
          {lookup.searches.length === 0 ? (
            <p className="text-muted-foreground">{t('noSearches')}</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {lookup.searches.map((search) => (
                <li key={search} className="rounded-md border bg-background px-2 py-0.5 font-mono">
                  {search}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="grid gap-1">
          <h4 className="font-medium">{t('pages')}</h4>
          {lookup.pages.length === 0 ? (
            <p className="text-muted-foreground">{t('noPages')}</p>
          ) : (
            <ul className="grid gap-1">
              {lookup.pages.map((page) => (
                <li key={page.url} className="grid">
                  <WebLink
                    href={page.url}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {page.title}
                  </WebLink>
                  <span className="text-muted-foreground">
                    {[page.site, page.date, page.read ? t('readInFull') : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </details>
  );
}

type FillDetail = Extract<ActionDetail, { kind: 'fill' }>;

/** What a card that fills a form will put into it: each part, the words it has now, and exactly what goes in. */
export function FillDetailView({ detail }: { detail: FillDetail }) {
  const t = useTranslations('workstation.card.fill');
  return (
    <div className="grid gap-3 rounded-lg border bg-muted/30 p-3">
      <p className="text-xs text-muted-foreground">
        <Link
          href={`/projects/${detail.projectId}/documents/${detail.documentId}`}
          className="font-medium text-foreground underline-offset-2 hover:underline"
        >
          {detail.number} · {detail.title}
        </Link>{' '}
        {t('version', { version: detail.versionNo })}
      </p>
      <ol className="grid gap-3">
        {detail.fills.map((fill, i) => (
          <li key={i} className="grid gap-1">
            <span className="text-xs font-medium text-muted-foreground">
              {fill.where.startsWith('table')
                ? t('partAt', { where: fill.where })
                : fill.where
                  ? t('inText')
                  : t('part', { part: fill.part })}
            </span>
            {fill.was && fill.mode === 'replace' && (
              <p className="text-xs text-muted-foreground line-through">{fill.was}</p>
            )}
            <p
              className={cn(
                'rounded-md border bg-background px-2 py-1 whitespace-pre-line',
                fill.mode !== 'replace' && 'border-dashed',
              )}
            >
              {fill.text}
            </p>
            {fill.mode !== 'replace' && (
              <span className="text-xs text-muted-foreground">{t(`mode.${fill.mode}`)}</span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
