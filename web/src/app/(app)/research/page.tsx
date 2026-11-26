'use client';

import { stepLabel } from '@coal/shared';
import { BookMarked, MessagesSquare } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ProblemMessage } from '@/components/problem-message';
import { RESEARCH_TONE } from '@/components/research/research-card';
import { Pill } from '@/components/status-badge';
import { formatDateTime } from '@/lib/format';
import { useResearchRuns } from '@/lib/queries';

/**
 * My research runs (docs/workstation-and-ai.md#researching-what-already-exists). Research starts
 * in the Workstation, where the assistant prepares a card with the search words.
 */
export default function ResearchPage() {
  const t = useTranslations('research');
  const runs = useResearchRuns();
  const items = runs.data ?? [];

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">{t('intro')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/workstation"
            className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
          >
            <MessagesSquare className="size-4" aria-hidden />
            {t('askInWorkstation')}
          </Link>
          <Link
            href="/research/sources"
            className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
          >
            <BookMarked className="size-4" aria-hidden />
            {t('library')}
          </Link>
        </div>
      </div>

      <ProblemMessage error={runs.error} />
      {runs.isPending && <p className="text-sm text-muted-foreground">{t('loading')}</p>}
      {runs.isSuccess && items.length === 0 && (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          {t('none')}
        </p>
      )}
      <ul className="grid gap-2">
        {items.map((run) => (
          <li key={run.id}>
            <Link
              href={`/research/${run.id}`}
              className="grid gap-1 rounded-xl border p-4 text-sm hover:bg-accent/50"
            >
              <span className="flex flex-wrap items-center gap-2">
                <Pill tone={RESEARCH_TONE[run.status]}>{t(`status.${run.status}`)}</Pill>
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(run.createdAt)} · {t('results', { count: run.resultCount })}
                </span>
              </span>
              <span className="font-medium">{run.question}</span>
              <span className="text-xs text-muted-foreground">
                {run.terms.join(' · ')}
                {run.project
                  ? ` · ${run.project.code}${run.stepKey ? `, ${stepLabel(run.stepKey)}` : ''}`
                  : ''}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
