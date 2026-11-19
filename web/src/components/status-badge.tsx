'use client';

import type { RequestStatus, StepView, TemplateStatus, VersionStatus } from '@coal/shared';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

const TONES = {
  neutral: 'bg-muted text-muted-foreground',
  active: 'bg-blue-100 text-blue-900',
  waiting: 'bg-warning text-warning-foreground',
  good: 'bg-emerald-100 text-emerald-900',
  bad: 'bg-red-100 text-red-900',
} as const;

export function Pill({ tone, children }: { tone: keyof typeof TONES; children: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        TONES[tone],
      )}
    >
      {children}
    </span>
  );
}

const PROJECT_TONE = {
  active: 'active',
  on_hold: 'waiting',
  dropped: 'bad',
  completed: 'good',
  closed: 'good',
} as const;

export function ProjectStatusBadge({ status }: { status: keyof typeof PROJECT_TONE }) {
  const t = useTranslations('status');
  return <Pill tone={PROJECT_TONE[status]}>{t(status)}</Pill>;
}

const STEP_TONE = {
  locked: 'neutral',
  ready: 'active',
  in_progress: 'active',
  in_review: 'waiting',
  returned: 'bad',
  approved: 'good',
  done: 'good',
  reset: 'neutral',
  cancelled: 'neutral',
} as const;

export function StepStatusBadge({ status }: { status: StepView['status'] }) {
  const t = useTranslations('stepStatus');
  return <Pill tone={STEP_TONE[status]}>{t(status)}</Pill>;
}

const DOCUMENT_TONE = {
  draft: 'neutral',
  in_review: 'waiting',
  returned: 'bad',
  approved: 'good',
  superseded: 'neutral',
} as const;

/** A document's or version's state; an approved one shows its revision letter. */
export function DocumentStatusBadge({
  status,
  rev,
}: {
  status: VersionStatus;
  rev?: string | null;
}) {
  const t = useTranslations('documentStatus');
  return (
    <Pill tone={DOCUMENT_TONE[status]}>
      {rev ? `${t(status)} · ${t('rev', { rev })}` : t(status)}
    </Pill>
  );
}

const TEMPLATE_TONE = { active: 'good', draft: 'waiting', retired: 'neutral' } as const;

export function TemplateStatusBadge({ status }: { status: TemplateStatus }) {
  const t = useTranslations('templateStatus');
  return <Pill tone={TEMPLATE_TONE[status]}>{t(status)}</Pill>;
}

const REQUEST_TONE = {
  waiting: 'neutral',
  pending: 'waiting',
  signed: 'good',
  returned: 'bad',
  cancelled: 'neutral',
} as const;

export function RequestStatusBadge({ status }: { status: RequestStatus }) {
  const t = useTranslations('requestStatus');
  return <Pill tone={REQUEST_TONE[status]}>{t(status)}</Pill>;
}
