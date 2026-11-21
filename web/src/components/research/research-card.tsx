'use client';

import type { ActionDetail } from '@coal/shared';
import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Pill } from '@/components/status-badge';
import { useResearchOfCard } from '@/lib/queries';

type ResearchInfo = Extract<ActionDetail, { kind: 'research' }>;

/** How a run's status looks. */
export const RESEARCH_TONE = {
  queued: 'active',
  running: 'active',
  done: 'good',
  failed: 'bad',
  stopped: 'neutral',
} as const;

/**
 * What a research card will do (docs/workstation-and-ai.md#researching-what-already-exists): the
 * question, which stays in COAL, and exactly the words that will leave it, and where they go.
 */
export function ResearchDetailView({ detail }: { detail: ResearchInfo }) {
  const t = useTranslations('workstation.card.research');
  return (
    <div className="grid gap-3 rounded-lg border bg-muted/30 p-3">
      <div className="grid gap-1">
        <span className="text-xs font-medium text-muted-foreground">{t('question')}</span>
        <p>{detail.question}</p>
      </div>
      <div className="grid gap-1">
        <span className="text-xs font-medium text-muted-foreground">{t('terms')}</span>
        <ul className="flex flex-wrap gap-1.5">
          {detail.terms.map((term) => (
            <li
              key={term}
              className="rounded-md border bg-background px-2 py-0.5 font-mono text-xs"
            >
              {term}
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          {t('termsNote')}
          {detail.since ? ` ${t('since', { year: detail.since })}` : ''}
        </p>
      </div>
      {detail.searched.length > 0 && (
        <div className="grid gap-1">
          <span className="text-xs font-medium text-muted-foreground">{t('searched')}</span>
          <p>{detail.searched.map((s) => s.name).join(', ')}</p>
        </div>
      )}
      {detail.linksOnly.length > 0 && (
        <div className="grid gap-1">
          <span className="text-xs font-medium text-muted-foreground">{t('linksOnly')}</span>
          <p>{detail.linksOnly.join(', ')}</p>
        </div>
      )}
      {detail.keepIn && (
        <div className="grid gap-1">
          <span className="text-xs font-medium text-muted-foreground">{t('keepIn')}</span>
          <p>{detail.keepIn}</p>
        </div>
      )}
    </div>
  );
}

/** Once the card is confirmed: how the run is doing, and where to read it. */
export function ResearchCardOutcome({ proposalId }: { proposalId: string }) {
  const t = useTranslations('workstation.card.research');
  const tStatus = useTranslations('research.status');
  const run = useResearchOfCard(proposalId, true);
  if (!run.data) return <p className="text-xs text-muted-foreground">{t('startedNote')}</p>;
  const working = run.data.status === 'queued' || run.data.status === 'running';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Pill tone={RESEARCH_TONE[run.data.status]}>{tStatus(run.data.status)}</Pill>
      <Link
        href={`/research/${run.data.id}`}
        className="inline-flex items-center gap-1 text-sm font-medium underline-offset-2 hover:underline"
      >
        {t('open')}
        <ExternalLink className="size-3.5" aria-hidden />
      </Link>
      {working && <span className="text-xs text-muted-foreground">{t('startedNote')}</span>}
    </div>
  );
}
