'use client';

import { claimTask, updateTask, type Task } from '@coal/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ProblemMessage } from '@/components/problem-message';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queries';

/** One task, with what its person can do: claim from a queue, start it, mark it done. */
export function TaskRow({ task }: { task: Task }) {
  const t = useTranslations('tasks');
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
  const claim = useMutation({
    mutationFn: () => api(claimTask, { params: { id: task.id } }),
    onSuccess: refresh,
  });
  const update = useMutation({
    mutationFn: (status: 'in_progress' | 'done') =>
      api(updateTask, { params: { id: task.id }, body: { status } }),
    onSuccess: refresh,
  });
  const error = claim.error ?? update.error;
  const queued = !task.assignee && task.queueRole;
  const open = ['open', 'in_progress', 'waiting'].includes(task.status);

  return (
    <li className="grid gap-1 rounded-lg border p-3 text-sm">
      <div className="flex items-start justify-between gap-3">
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
            {!open && <> · {t(`status.${task.status}`)}</>}
          </span>
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
              <Button size="sm" onClick={() => update.mutate('done')} disabled={update.isPending}>
                {t('done')}
              </Button>
            </>
          )}
        </div>
      </div>
      <ProblemMessage error={error} />
    </li>
  );
}
