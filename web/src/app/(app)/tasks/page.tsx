'use client';

import { groupByLine } from '@coal/shared';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Suspense, useState } from 'react';
import { LineHeading } from '@/components/line-heading';
import { NewTaskDialog } from '@/components/new-task-dialog';
import { ProblemMessage } from '@/components/problem-message';
import { TaskRow } from '@/components/task-row';
import { WaitingSignatures } from '@/components/waiting-signatures';
import { Button } from '@/components/ui/button';
import { flatten, useTasks } from '@/lib/queries';
import { cn } from '@/lib/utils';

type Scope = 'mine' | 'queue' | 'sent';
const SCOPES: Scope[] = ['mine', 'queue', 'sent'];

export default function TasksPage() {
  return (
    <Suspense fallback={null}>
      <Tasks />
    </Suspense>
  );
}

/** My tasks: what is assigned to me, what is waiting in my role's queue, and what I gave others. */
function Tasks() {
  const t = useTranslations('tasks');
  const asked = useSearchParams().get('scope') as Scope | null;
  const [scope, setScope] = useState<Scope>(asked && SCOPES.includes(asked) ? asked : 'mine');
  const [status, setStatus] = useState<'active' | 'closed'>('active');
  const [creating, setCreating] = useState(false);
  const tasks = useTasks(scope, status);
  const items = flatten(tasks.data?.pages);

  const tab = (active: boolean) =>
    cn(
      'rounded-md px-3 py-1.5 text-sm font-medium',
      active ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
    );

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('intro')}</p>
        </div>
        <Button onClick={() => setCreating(true)}>{t('new')}</Button>
      </div>
      <NewTaskDialog open={creating} onOpenChange={setCreating} />

      <WaitingSignatures />

      <div className="flex flex-wrap gap-4">
        <div className="flex rounded-lg bg-muted p-1">
          <button className={tab(scope === 'mine')} onClick={() => setScope('mine')}>
            {t('mine')}
          </button>
          <button className={tab(scope === 'queue')} onClick={() => setScope('queue')}>
            {t('queue')}
          </button>
          <button className={tab(scope === 'sent')} onClick={() => setScope('sent')}>
            {t('sent')}
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
      <div className="grid gap-5">
        {groupByLine(items, (task) => task.productLine).map((group) => (
          <section key={group.key} className="grid gap-2">
            {items.some((task) => task.productLine) && (
              <LineHeading
                as="h2"
                name={group.name}
                count={tasks.hasNextPage ? undefined : group.items.length}
              />
            )}
            <ul className="grid gap-2">
              {group.items.map((task) => (
                <TaskRow key={task.id} task={task} sent={scope === 'sent'} />
              ))}
            </ul>
          </section>
        ))}
      </div>
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
