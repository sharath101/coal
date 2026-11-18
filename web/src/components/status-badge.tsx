'use client';

import type { StepView } from '@coal/shared';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

const TONES = {
  neutral: 'bg-muted text-muted-foreground',
  active: 'bg-blue-100 text-blue-900',
  waiting: 'bg-warning text-warning-foreground',
  good: 'bg-emerald-100 text-emerald-900',
  bad: 'bg-red-100 text-red-900',
} as const;

function Pill({ tone, children }: { tone: keyof typeof TONES; children: string }) {
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
