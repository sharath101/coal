'use client';

import type { StepView } from '@coal/shared';
import { useTranslations } from 'next-intl';
import { Pill } from '@/components/status-badge';
import { cn } from '@/lib/utils';

export type Health = 'green' | 'amber' | 'red';

const DOT = { green: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-red-600' } as const;
const TONE = { green: 'good', amber: 'waiting', red: 'bad' } as const;

/** A coloured dot with a text alternative, for rows where a badge would be too much. */
export function HealthDot({ health }: { health: Health | null }) {
  const t = useTranslations('health');
  return (
    <span
      role="img"
      aria-label={t(health ?? 'none')}
      title={t(health ?? 'none')}
      className={cn(
        'inline-block size-2.5 shrink-0 rounded-full',
        health ? DOT[health] : 'bg-muted',
      )}
    />
  );
}

/** A project's health: green, amber, red, or none once it is dropped or launched. */
export function HealthBadge({ health, title }: { health: Health | null; title?: string }) {
  const t = useTranslations('health');
  return (
    <span title={title} className="inline-flex">
      <Pill tone={health ? TONE[health] : 'neutral'}>{t(health ?? 'none')}</Pill>
    </span>
  );
}

const STEP_TONE = { ok: 'good', at_risk: 'waiting', overdue: 'bad' } as const;

/** A step's health. `quiet` hides "on time", so a list shows only what needs a look. */
export function StepHealthBadge({
  health,
  quiet = false,
}: {
  health: StepView['health'];
  quiet?: boolean;
}) {
  const t = useTranslations('stepHealth');
  if (!health || (quiet && health === 'ok')) return null;
  return <Pill tone={STEP_TONE[health]}>{t(health)}</Pill>;
}
