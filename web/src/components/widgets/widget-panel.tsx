'use client';

import { markAllNotificationsRead, type WidgetRow } from '@coal/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, X } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ProblemMessage } from '@/components/problem-message';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { formatTime } from '@/lib/format';
import { queryKeys, useWidget, type WidgetInfo } from '@/lib/queries';
import { AskAiButton } from '@/components/widgets/widget-card';
import { Cell } from '@/components/widgets/cells';
import { CountStats, useWidgetText } from '@/components/widgets/count-stats';
import { RowActions, rowHasActions } from '@/components/widgets/row-actions';
import { WidgetFilters } from '@/components/widgets/widget-filters';
import { RowBadges, toneBar } from '@/components/widgets/widget-parts';
import { QUESTION_TITLE, type PanelState } from '@/components/widgets/panel-state';
import { cn } from '@/lib/utils';

interface Props {
  info: WidgetInfo;
  state: PanelState;
  /** Tab and filters live in the URL: a change is a new state. */
  onChange: (next: PanelState) => void;
  onClose: () => void;
}

function RowTitle({ row }: { row: WidgetRow }) {
  return (
    <div className="grid gap-1">
      {row.link ? (
        <Link href={row.link} className="font-medium underline-offset-2 hover:underline">
          {row.title}
        </Link>
      ) : (
        <span className="font-medium">{row.title}</span>
      )}
      {row.subtitle && <span className="text-xs text-muted-foreground">{row.subtitle}</span>}
      <RowBadges badges={row.badges} />
    </div>
  );
}

/** The expanded view: a large panel over the Dashboard, a full screen on a phone. */
export function WidgetPanel({ info, state, onChange, onClose }: Props) {
  const t = useTranslations('widgets');
  const tDashboard = useTranslations('dashboard');
  const { name } = useWidgetText(info.key);
  const question = tDashboard(QUESTION_TITLE[info.question]);
  const queryClient = useQueryClient();
  const widget = useWidget(info.key, { view: 'expanded', tab: state.tab, filters: state.filters });
  const data = widget.data;
  const activeTab = state.tab ?? data?.tab ?? info.tabs[0] ?? null;
  const showActions = (data?.rows ?? []).some(rowHasActions);
  const markAll = useMutation({
    mutationFn: () => api(markAllNotificationsRead),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.notifications }),
        queryClient.invalidateQueries({ queryKey: queryKeys.widget('messages') }),
      ]),
  });

  const table = (
    <div className="grid gap-3" aria-busy={widget.isFetching}>
      <ProblemMessage error={widget.error ?? markAll.error} />
      {!data && !widget.error && <p className="text-sm text-muted-foreground">{t('loading')}</p>}
      {data && data.rows.length === 0 && (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {Object.values(state.filters).some(Boolean) ? t('noMatch') : t(`empty.${info.key}`)}
        </p>
      )}
      {data && data.rows.length > 0 && (
        <>
          <div className="hidden overflow-x-auto rounded-lg border md:block">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground uppercase">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t(`itemHeader.${info.key}`)}
                  </th>
                  {info.columns.map((column) => (
                    <th key={column} scope="col" className="px-3 py-2 font-medium">
                      {t(`columns.${column}` as never)}
                    </th>
                  ))}
                  {showActions && (
                    <th scope="col" className="px-3 py-2 font-medium">
                      {t('actionsHeader')}
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.id} className="border-t align-top">
                    <td className={cn('px-3 py-2', toneBar(row.tone))}>
                      <RowTitle row={row} />
                    </td>
                    {info.columns.map((column) => (
                      <td key={column} className="px-3 py-2">
                        <Cell widget={info.key} column={column} value={row.cells[column]} />
                      </td>
                    ))}
                    {showActions && (
                      <td className="px-3 py-2">
                        <RowActions row={row} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="grid gap-2 md:hidden">
            {data.rows.map((row) => (
              <li
                key={row.id}
                className={cn('grid gap-2 rounded-lg border p-3', toneBar(row.tone))}
              >
                <RowTitle row={row} />
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                  {info.columns.map((column) => (
                    <div key={column} className="contents">
                      <dt className="text-muted-foreground">{t(`columns.${column}` as never)}</dt>
                      <dd>
                        <Cell widget={info.key} column={column} value={row.cells[column]} />
                      </dd>
                    </div>
                  ))}
                </dl>
                {showActions && <RowActions row={row} />}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            {data.total > data.rows.length
              ? t('showing', { shown: data.rows.length, total: data.total })
              : t('rowCount', { count: data.rows.length })}
            {' · '}
            {t('updated', { when: formatTime(data.asOf) })}
          </p>
        </>
      )}
    </div>
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="panel">
        <header className="flex items-center gap-2 border-b p-3 sm:p-4">
          <DialogClose asChild>
            <Button variant="ghost" size="sm">
              <ArrowLeft aria-hidden />
              {t('back')}
            </Button>
          </DialogClose>
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-lg font-semibold">{name}</DialogTitle>
            <DialogDescription className="truncate text-xs text-muted-foreground">
              {question}
            </DialogDescription>
          </div>
          <AskAiButton widgetKey={info.key} />
          <DialogClose asChild>
            <Button variant="ghost" size="icon-sm" aria-label={t('close')}>
              <X aria-hidden />
            </Button>
          </DialogClose>
        </header>

        <div className="grid flex-1 content-start gap-4 overflow-y-auto p-3 sm:p-4">
          {data && <CountStats widget={info.key} counts={data.counts} size="sm" />}
          <WidgetFilters
            info={info}
            filters={state.filters}
            onChange={(filters) => onChange({ ...state, filters })}
          />
          {info.key === 'messages' && (
            <div>
              <Button
                size="sm"
                variant="outline"
                disabled={markAll.isPending || (data?.counts[0]?.value ?? 0) === 0}
                onClick={() => markAll.mutate()}
              >
                {t('actions.markAll')}
              </Button>
            </div>
          )}
          {info.tabs.length > 0 && activeTab ? (
            <Tabs value={activeTab} onValueChange={(tab) => onChange({ ...state, tab })}>
              <TabsList aria-label={t('tabs.heading')}>
                {info.tabs.map((tab) => {
                  const count = data?.tabs.find((x) => x.key === tab)?.count;
                  return (
                    <TabsTrigger key={tab} value={tab}>
                      {t(`tabs.${tab}` as never)}
                      {count !== undefined && (
                        <span className="rounded-full bg-foreground/10 px-1.5 text-xs">
                          {count}
                        </span>
                      )}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
              <TabsContent value={activeTab} className="mt-3">
                {table}
              </TabsContent>
            </Tabs>
          ) : (
            table
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
