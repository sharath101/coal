'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ProblemMessage } from '@/components/problem-message';
import { TaskRow } from '@/components/task-row';
import { Button } from '@/components/ui/button';
import { flatten, useTasks } from '@/lib/queries';
import { cn } from '@/lib/utils';

/** My tasks: what is assigned to me, and what is waiting in my role's queue. */
export default function TasksPage() {
  const t = useTranslations('tasks');
  const [scope, setScope] = useState<'mine' | 'queue'>('mine');
  const [status, setStatus] = useState<'active' | 'closed'>('active');
  const tasks = useTasks(scope, status);
  const items = flatten(tasks.data?.pages);

  const tab = (active: boolean) =>
    cn(
      'rounded-md px-3 py-1.5 text-sm font-medium',
      active ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
    );

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
      </div>

      <div className="flex flex-wrap gap-4">
        <div className="flex rounded-lg bg-muted p-1">
          <button className={tab(scope === 'mine')} onClick={() => setScope('mine')}>
            {t('mine')}
          </button>
          <button className={tab(scope === 'queue')} onClick={() => setScope('queue')}>
            {t('queue')}
          </button>
        </div>
        <div className="flex rounded-lg bg-muted p-1">
          <button className={tab(status === 'active')} onClick={() => setStatus('active')}>
            {t('active')}
          </button>
          <button className={tab(status === 'closed')} onClick={() => setStatus('closed')}>
            {t('closed')}
          </button>
        </div>
      </div>

      <ProblemMessage error={tasks.error} />
      {tasks.isSuccess && items.length === 0 && (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          {t('none')}
        </p>
      )}
      <ul className="grid gap-2">
        {items.map((task) => (
          <TaskRow key={task.id} task={task} />
        ))}
      </ul>
      {tasks.hasNextPage && (
        <Button
          variant="outline"
          className="justify-self-start"
          disabled={tasks.isFetchingNextPage}
          onClick={() => void tasks.fetchNextPage()}
        >
          {t('more')}
        </Button>
      )}
    </div>
  );
}
