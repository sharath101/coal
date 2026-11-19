'use client';

import type { Tone, WidgetData, WidgetKey } from '@coal/shared';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

const TONE_TILE: Record<Tone, string> = {
  neutral: 'bg-muted/50 text-foreground',
  good: 'bg-emerald-50 text-emerald-800',
  warning: 'bg-amber-50 text-amber-800',
  danger: 'bg-red-50 text-red-800',
};

/** Names and labels of a widget, in words. Falls back to the API's own where a label is missing. */
export function useWidgetText(key: WidgetKey) {
  const t = useTranslations('widgets');
  return {
    name: t(`names.${key}`),
    count: (countKey: string) =>
      t.has(`counts.${key}.${countKey}` as never)
        ? t(`counts.${key}.${countKey}` as never)
        : countKey,
  };
}

/** The headline numbers of a widget, coloured by tone. A null value (nothing to measure yet) is a dash. */
export function CountStats({
  widget,
  counts,
  size = 'md',
}: {
  widget: WidgetKey;
  counts: WidgetData['counts'];
  size?: 'sm' | 'md';
}) {
  const t = useTranslations('widgets');
  const { count } = useWidgetText(widget);
  const percent = widget === 'how-its-going';
  return (
    <dl className="flex flex-wrap gap-2">
      {counts.map((c) => (
        <div
          key={c.key}
          className={cn(
            'flex min-w-16 flex-col-reverse gap-0.5 rounded-lg px-3 py-1.5',
            size === 'sm' && 'px-2 py-1',
            TONE_TILE[c.tone],
          )}
        >
          <dt className="text-xs opacity-80">{count(c.key)}</dt>
          <dd className={cn('text-xl leading-tight font-semibold', size === 'sm' && 'text-base')}>
            {c.value === null ? t('noValue') : percent ? t('percent', { value: c.value }) : c.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
