'use client';

import type { WidgetKey } from '@coal/shared';
import { Maximize2, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { HealthDot, type Health } from '@/components/health-badge';
import { LineHeading } from '@/components/line-heading';
import { ProblemMessage } from '@/components/problem-message';
import { useCellText } from '@/components/widgets/cells';
import { useWidgetText, CountStats } from '@/components/widgets/count-stats';
import { groupRows, subtitleOf } from '@/components/widgets/group-rows';
import { RowBadges, StageStrip, toneBar } from '@/components/widgets/widget-parts';
import { Button } from '@/components/ui/button';
import { useWidget, type WidgetInfo } from '@/lib/queries';
import { workstationHref } from '@/lib/workstation';
import { cn } from '@/lib/utils';

/** The cells shown under a row on the compact card: the date or number that matters most. */
const COMPACT_CELLS: Record<WidgetKey, string[]> = {
  'my-tasks': ['due', 'waitingOn'],
  'waiting-signature': ['row', 'waiting'],
  'coming-up': ['starts'],
  'upcoming-checkpoints': ['date'],
  'my-projects': ['next', 'milestone', 'milestoneDue'],
  pipeline: ['launch'],
  'delays-risks': ['forecast'],
  'team-workload': ['open', 'overdue'],
  'how-its-going': ['onTime'],
  messages: ['when'],
};

const isHealth = (value: unknown): value is Health =>
  value === 'green' || value === 'amber' || value === 'red';

/** "Ask AI": opens the Workstation with a new chat about this widget. */
export function AskAiButton({ widgetKey }: { widgetKey: WidgetKey }) {
  const t = useTranslations('widgets');
  return (
    <Button asChild size="xs" variant="outline">
      <Link href={workstationHref({ widgetKey })}>
        <Sparkles aria-hidden />
        {t('ask')}
      </Link>
    </Button>
  );
}

/** A widget as a compact card: its counts, its top rows, and a way into the expanded view. */
export function WidgetCard({ info, onOpen }: { info: WidgetInfo; onOpen: () => void }) {
  const t = useTranslations('widgets');
  const { name } = useWidgetText(info.key);
  const cellText = useCellText(info.key);
  const widget = useWidget(info.key, { view: 'compact' });
  const data = widget.data;
  const { grouped, groups } = groupRows(data?.rows ?? []);
  const headingId = `widget-${info.key}`;

  return (
    <section
      aria-labelledby={headingId}
      className="flex cursor-pointer flex-col gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-foreground/30"
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest('a,button')) onOpen();
      }}
    >
      <header className="flex items-start justify-between gap-2">
        <h3 id={headingId} className="font-medium">
          {name}
        </h3>
        <div className="flex shrink-0 gap-1">
          <AskAiButton widgetKey={info.key} />
          <Button
            size="xs"
            variant="ghost"
            onClick={onOpen}
            aria-label={t('openWidget', { title: name })}
          >
            <Maximize2 aria-hidden />
            {t('open')}
          </Button>
        </div>
      </header>

      <ProblemMessage error={widget.error} />
      {!data && !widget.error && <p className="text-sm text-muted-foreground">{t('loading')}</p>}
      {data && (
        <>
          <CountStats widget={info.key} counts={data.counts} />
          {data.rows.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
              {t(`empty.${info.key}`)}
            </p>
          ) : (
            <div className="grid gap-3">
              {groups.map((group, index) => (
                <div key={group.key} className={cn('grid gap-2', index > 0 && 'border-t pt-3')}>
                  {grouped && <LineHeading name={group.name} />}
                  <ul className="grid gap-2">
                    {group.items.map((row) => {
                      const stage = row.cells.stage;
                      const health = row.cells.health;
                      return (
                        <li
                          key={row.id}
                          className={cn('flex items-start gap-2 pl-2', toneBar(row.tone))}
                        >
                          <div className="grid min-w-0 flex-1 gap-0.5 text-sm">
                            {row.link ? (
                              <Link
                                href={row.link}
                                className="font-medium underline-offset-2 hover:underline"
                              >
                                {row.title}
                              </Link>
                            ) : (
                              <span className="font-medium">{row.title}</span>
                            )}
                            {subtitleOf(row) && (
                              <span className="line-clamp-2 text-xs text-muted-foreground">
                                {subtitleOf(row)}
                              </span>
                            )}
                            {(typeof stage === 'number' || isHealth(health)) && (
                              <span className="flex items-center gap-2 py-0.5">
                                {typeof stage === 'number' && <StageStrip stage={stage} />}
                                {isHealth(health) && <HealthDot health={health} />}
                              </span>
                            )}
                            <span className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                              {/* A cell with nothing in it is left out, so a row says only what it has. */}
                              {COMPACT_CELLS[info.key]
                                .filter((column) => (row.cells[column] ?? '') !== '')
                                .map((column) => (
                                  <span key={column}>
                                    {t(`columns.${column}` as never)}{' '}
                                    {cellText(column, row.cells[column])}
                                  </span>
                                ))}
                            </span>
                          </div>
                          <RowBadges badges={row.badges} />
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
          {data.total > data.rows.length && (
            <p className="text-xs text-muted-foreground">
              {t('moreRows', { count: data.total - data.rows.length })}
            </p>
          )}
        </>
      )}
    </section>
  );
}
