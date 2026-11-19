'use client';

import { markNotificationRead, updateTask, type WidgetRow } from '@coal/shared';
import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { RecordDeviationDialog } from '@/components/deviation-dialog';
import { ProblemMessage } from '@/components/problem-message';
import { ReturnRequestDialog, SignRequestDialog } from '@/components/row-signing-dialogs';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { isDeviationRequired } from '@/lib/deviation';
import { useRefreshWork } from '@/lib/queries';

type Dialog = 'late' | 'time' | 'sign' | 'return' | null;

/** Whether the row has anything to do on it: reassigning needs a page to go to. */
export function rowHasActions(row: WidgetRow): boolean {
  return row.actions.some((a) => a !== 'reassign' || !!row.link);
}

/**
 * What the viewer may do with one row, as small buttons: the actions the API lists for the row,
 * where the row carries what the action needs. Marking a late task done asks why it is late first.
 */
export function RowActions({ row }: { row: WidgetRow }) {
  const t = useTranslations('widgets');
  const refresh = useRefreshWork();
  const [dialog, setDialog] = useState<Dialog>(null);
  const { taskId, requestId, notificationId } = row.ref;
  const has = (action: string) => row.actions.includes(action);

  const setStatus = (status: 'in_progress' | 'done') =>
    api(updateTask, { params: { id: taskId ?? '' }, body: { status } });
  const start = useMutation({ mutationFn: () => setStatus('in_progress'), onSuccess: refresh });
  const done = useMutation({
    mutationFn: () => setStatus('done'),
    onSuccess: refresh,
    onError: (error) => {
      if (isDeviationRequired(error)) setDialog('late');
    },
  });
  const read = useMutation({
    mutationFn: () => api(markNotificationRead, { params: { id: notificationId ?? '' } }),
    onSuccess: refresh,
  });
  const busy = start.isPending || done.isPending || read.isPending;
  const error = start.error ?? done.error ?? read.error;
  const hideError = dialog === 'late' && isDeviationRequired(done.error);

  const small = { size: 'xs', variant: 'outline' } as const;
  return (
    <div className="grid gap-1">
      <div className="flex flex-wrap gap-1">
        {taskId && has('start') && (
          <Button {...small} disabled={busy} onClick={() => start.mutate()}>
            {t('actions.start')}
          </Button>
        )}
        {taskId && has('done') && (
          <Button {...small} disabled={busy} onClick={() => done.mutate()}>
            {t('actions.done')}
          </Button>
        )}
        {taskId && has('more_time') && (
          <Button {...small} onClick={() => setDialog('time')}>
            {t('actions.more_time')}
          </Button>
        )}
        {requestId && has('sign') && (
          <Button {...small} onClick={() => setDialog('sign')}>
            {t('actions.sign')}
          </Button>
        )}
        {requestId && has('return') && (
          <Button {...small} onClick={() => setDialog('return')}>
            {t('actions.return')}
          </Button>
        )}
        {notificationId && has('mark_read') && (
          <Button {...small} disabled={busy} onClick={() => read.mutate()}>
            {t('actions.mark_read')}
          </Button>
        )}
        {row.link && (has('open') || has('reassign')) && (
          <Button {...small} asChild>
            <Link href={row.link}>{has('open') ? t('actions.open') : t('actions.reassign')}</Link>
          </Button>
        )}
      </div>
      {!hideError && <ProblemMessage error={error} />}

      {taskId && (
        <RecordDeviationDialog
          open={dialog === 'late' || dialog === 'time'}
          onOpenChange={(open) => !open && setDialog(null)}
          tasks={[{ id: taskId, title: row.title }]}
          intro={dialog === 'late' ? t('lateIntro') : undefined}
          onRecorded={() => {
            if (dialog === 'late') done.mutate();
          }}
        />
      )}
      {requestId && (
        <>
          <SignRequestDialog
            open={dialog === 'sign'}
            onOpenChange={(open) => !open && setDialog(null)}
            requestId={requestId}
            title={row.title}
            link={row.link}
            meaning={String(row.cells.row ?? '')}
          />
          <ReturnRequestDialog
            open={dialog === 'return'}
            onOpenChange={(open) => !open && setDialog(null)}
            requestId={requestId}
            title={row.title}
          />
        </>
      )}
    </div>
  );
}
