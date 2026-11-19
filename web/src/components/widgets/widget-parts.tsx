'use client';

import type { Tone, WidgetRow } from '@coal/shared';
import { useTranslations } from 'next-intl';
import { Pill } from '@/components/status-badge';
import { cn } from '@/lib/utils';

export const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-foreground',
  good: 'text-emerald-700',
  warning: 'text-amber-700',
  danger: 'text-red-700',
};

const TONE_BAR: Record<Tone, string> = {
  neutral: 'border-transparent',
  good: 'border-emerald-500',
  warning: 'border-amber-500',
  danger: 'border-red-600',
};

const TONE_PILL = { neutral: 'neutral', good: 'good', warning: 'waiting', danger: 'bad' } as const;

/** A coloured bar on the left of a row: red when late, amber when due soon. */
export const toneBar = (tone: Tone) => cn('border-l-4', TONE_BAR[tone]);

export function RowBadges({ badges }: { badges: WidgetRow['badges'] }) {
  if (badges.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {badges.map((b) => (
        <Pill key={b.label} tone={TONE_PILL[b.tone]}>
          {b.label}
        </Pill>
      ))}
    </span>
  );
}

/** The six stages of the route as a strip; the current one is dark. */
export function StageStrip({ stage }: { stage: number }) {
  const t = useTranslations('widgets');
  return (
    <span role="img" aria-label={t('stageOf', { stage })} className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5, 6].map((n) => (
        <span
          key={n}
          className={cn(
            'h-2 w-4 rounded-sm',
            n < stage && 'bg-foreground/40',
            n === stage && 'bg-foreground',
            n > stage && 'bg-muted',
          )}
        />
      ))}
    </span>
  );
}
