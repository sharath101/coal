'use client';

import { stepLabel, type WidgetKey, type WidgetRow } from '@coal/shared';
import { useTranslations } from 'next-intl';
import { HealthBadge, type Health } from '@/components/health-badge';
import { StageStrip } from '@/components/widgets/widget-parts';
import { formatDate, formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';

export type CellValue = WidgetRow['cells'][string];

const DATE_COLUMNS = new Set([
  'due',
  'starts',
  'date',
  'next',
  'launch',
  'planned',
  'forecast',
  'milestoneDue',
]);
const PERCENT_COLUMNS = new Set(['onTime', 'rework']);
const DAY_COLUMNS = new Set(['daysInStage', 'waiting', 'signTurnaround', 'daysLate']);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** What the API calls a kind of waiting signature, by the word it sends. */
const WHAT: Record<string, 'document' | 'stepSignOff'> = {
  Document: 'document',
  'Step sign-off': 'stepSignOff',
};

const isHealth = (value: unknown): value is Health =>
  value === 'green' || value === 'amber' || value === 'red';

/**
 * The text of one cell of an expanded table or a compact card: dates in Indian style, percentages
 * with a % sign, a dash where there is nothing to show, and the codes of the API in words.
 */
export function useCellText(widget: WidgetKey) {
  const t = useTranslations('widgets');
  const tTask = useTranslations('tasks');
  const tDeviation = useTranslations('deviation');
  const tMeaning = useTranslations('meaning');

  return (column: string, value: CellValue | undefined): string => {
    if (value === null || value === undefined || value === '') return t('noValue');
    if (typeof value === 'boolean') return value ? t('yes') : t('no');
    const text = String(value);
    if (DATE_COLUMNS.has(column) && ISO_DAY.test(text)) return formatDate(text);
    if (column === 'when') return formatTime(text);
    if (PERCENT_COLUMNS.has(column)) return t('percent', { value: Number(value) });
    if (DAY_COLUMNS.has(column)) {
      return t('days', { count: Math.round(Number(value) * 10) / 10 });
    }
    if (column === 'step') return t('step', { key: stepLabel(text) });
    if (column === 'kind') {
      if (widget === 'messages') {
        return t.has(`notificationKind.${text}` as never)
          ? t(`notificationKind.${text}` as never)
          : text;
      }
      return tTask.has(`kind.${text}` as never) ? tTask(`kind.${text}` as never) : text;
    }
    if (column === 'status') {
      return tTask.has(`status.${text}` as never) ? tTask(`status.${text}` as never) : text;
    }
    if (column === 'reason') {
      return tDeviation.has(`reasons.${text}` as never)
        ? tDeviation(`reasons.${text}` as never)
        : text;
    }
    if (column === 'row') {
      return tMeaning.has(text as never) ? tMeaning(text as never) : text;
    }
    if (column === 'what') {
      const known = WHAT[text];
      return known ? t(`what.${known}`) : text;
    }
    if (column === 'stage') return t('stageOf', { stage: Number(value) });
    return text;
  };
}

/** One cell of the table: the stage as a strip, health as a badge, lateness in red. */
export function Cell({
  widget,
  column,
  value,
}: {
  widget: WidgetKey;
  column: string;
  value: CellValue | undefined;
}) {
  const text = useCellText(widget);
  if (column === 'stage' && typeof value === 'number') {
    return (
      <span className="inline-flex items-center gap-2 whitespace-nowrap">
        <StageStrip stage={value} />
        <span className="text-xs text-muted-foreground">{text(column, value)}</span>
      </span>
    );
  }
  if (column === 'health') {
    return isHealth(value) ? <HealthBadge health={value} /> : <span>{text(column, null)}</span>;
  }
  const late =
    (column === 'daysLate' || column === 'overdue') && typeof value === 'number' && value > 0;
  const short = DATE_COLUMNS.has(column) || PERCENT_COLUMNS.has(column) || DAY_COLUMNS.has(column);
  return (
    <span className={cn(short && 'whitespace-nowrap', late && 'font-medium text-red-700')}>
      {text(column, value)}
    </span>
  );
}
