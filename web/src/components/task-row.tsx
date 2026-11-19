'use client';

import { claimTask, updateTask, type Task } from '@coal/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { RecordDeviationDialog } from '@/components/deviation-dialog';
import { ProblemMessage } from '@/components/problem-message';
import { Pill } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { isDeviationRequired } from '@/lib/deviation';
import { formatDate } from '@/lib/format';
import { queryKeys, useRefreshWork } from '@/lib/queries';

/**
 * One task, with what its person can do: claim from a queue, start it, mark it done, ask for more
 * time. A late task shows how late; it can't be marked done until someone says why it is late,
 * and the dialog for that comes up when the API asks.
 */
export function TaskRow({ task }: { task: Task }) {
  const t = useTranslations('tasks');
  const queryClient = useQueryClient();
  const refreshWork = useRefreshWork();
  const [deviation, setDeviation] = useState<'late' | 'time' | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
  const claim = useMutation({
    mutationFn: () => api(claimTask, { params: { id: task.id } }),
    onSuccess: refresh,
  });
  const update = useMutation({
    mutationFn: (status: 'in_progress' | 'done') =>
      api(updateTask, { params: { id: task.id }, body: { status } }),
    onSuccess: () => void refreshWork(),
    onError: (error, status) => {
      if (status === 'done' && isDeviationRequired(error)) setDeviation('late');
    },
  });
  const error = claim.error ?? update.error;
  const queued = !task.assignee && task.queueRole;
  const open = ['open', 'in_progress', 'waiting'].includes(task.status);

  return (
    <li className="grid gap-1 rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-0.5">
          <span className="font-medium">{task.title}</span>
          <span className="text-xs text-muted-foreground">
            {task.subject && (
              <Link
                href={`/projects/${task.subject.id}`}
                className="underline-offset-2 hover:underline"
              >
                {task.subject.label}
              </Link>
            )}
            {task.stepKey && <> · {t('step', { key: task.stepKey })}</>} · {t(`kind.${task.kind}`)}
            {queued && task.queueRole && <> · {t('queueFor', { role: task.queueRole.name })}</>}
            {(!open || task.status === 'waiting') && <> · {t(`status.${task.status}`)}</>}
            {open && task.dueOn && <> · {t('due', { date: formatDate(task.dueOn) })}</>}
          </span>
          {open && task.daysLate > 0 && (
            <span className="mt-1">
              <Pill tone="bad">{t('daysLate', { count: task.daysLate })}</Pill>
            </span>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          {queued && open && (
            <Button size="sm" onClick={() => claim.mutate()} disabled={claim.isPending}>
              {t('claim')}
            </Button>
          )}
          {!queued && open && (
            <>
              {task.status === 'open' && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => update.mutate('in_progress')}
                  disabled={update.isPending}
                >
                  {t('start')}
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => setDeviation('time')}
                disabled={update.isPending}
              >
                {t('moreTime')}
              </Button>
              <Button size="sm" onClick={() => update.mutate('done')} disabled={update.isPending}>
                {t('done')}
              </Button>
            </>
          )}
        </div>
      </div>
      <ProblemMessage error={deviation === 'late' ? null : error} />
      <RecordDeviationDialog
        open={deviation !== null}
        onOpenChange={(next) => !next && setDeviation(null)}
        tasks={[{ id: task.id, title: task.title }]}
        intro={deviation === 'late' ? t('lateIntro') : undefined}
        onRecorded={() => {
          if (deviation === 'late') update.mutate('done');
        }}
      />
    </li>
  );
}
