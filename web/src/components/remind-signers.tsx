'use client';

import { dateOfInstant, remindSigners, type SignOffWait } from '@coal/shared';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { formatDate, todayIst } from '@/lib/format';
import { useRefreshWork } from '@/lib/queries';

/** The people a handed-in step waits on: those who have not signed yet, or the signer's queue. */
export function useWaitingOnNames() {
  const t = useTranslations('signOffWait');
  return (wait: SignOffWait) =>
    [
      ...wait.pending.map((p) => p.name),
      ...(wait.queued ? [t('queue', { role: wait.signer.name })] : []),
    ].join(', ');
}

/**
 * Who a handed-in step waits on: with the signer since when, who has not signed yet, their date
 * and how late they are, and the last reminder. The lateness is theirs, not the doers'.
 */
export function SignOffWaitText({ wait }: { wait: SignOffWait }) {
  const t = useTranslations('signOffWait');
  const names = useWaitingOnNames();
  const reminded = wait.lastReminder;
  const remindedOn = reminded ? dateOfInstant(new Date(reminded.at)) : null;
  return (
    <>
      {t('with', {
        role: wait.signer.name,
        since: formatDate(dateOfInstant(new Date(wait.since))),
      })}{' '}
      {t('notSigned', { names: names(wait) })}
      {wait.dueOn && (
        <>
          {' '}
          {wait.daysLate > 0
            ? t('late', { date: formatDate(wait.dueOn), count: wait.daysLate })
            : t('dueBy', { date: formatDate(wait.dueOn) })}
        </>
      )}
      {reminded && remindedOn && (
        <>
          {' '}
          {remindedOn === todayIst()
            ? t('remindedToday', { name: reminded.by.name })
            : t('remindedOn', { name: reminded.by.name, date: formatDate(remindedOn) })}
        </>
      )}
    </>
  );
}

/**
 * "Remind them": the doers nudge the signers who have not signed a step yet. It asks first, then
 * each of them gets a notification. Once a day; the API refuses a second one.
 */
export function RemindSigners({
  projectId,
  stepKey,
  wait,
  size = 'sm',
}: {
  projectId: string;
  stepKey: string;
  wait: SignOffWait;
  size?: 'xs' | 'sm';
}) {
  const t = useTranslations('signOffWait');
  const names = useWaitingOnNames();
  const refresh = useRefreshWork();
  const [open, setOpen] = useState(false);
  const remind = useMutation({
    mutationFn: () => api(remindSigners, { params: { id: projectId, key: stepKey } }),
    onSuccess: () => {
      setOpen(false);
      void refresh();
    },
  });
  if (wait.remindedToday) return null;
  return (
    <>
      <Button size={size} variant="outline" onClick={() => setOpen(true)}>
        {t('remind')}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) remind.reset();
        }}
        title={t('confirmTitle', { step: stepKey })}
        text={t('confirmText', { names: names(wait), step: stepKey })}
        confirmLabel={t('remind')}
        onConfirm={() => remind.mutate()}
        pending={remind.isPending}
        error={remind.error}
      />
    </>
  );
}
