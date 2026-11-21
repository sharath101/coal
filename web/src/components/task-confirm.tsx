'use client';

import { useTranslations } from 'next-intl';
import { ConfirmDialog } from '@/components/confirm-dialog';

export type TaskAction = 'claim' | 'accept' | 'start' | 'done';

/**
 * The "are you sure?" for a task's one-click actions: claiming from a queue, accepting a request,
 * starting and marking done. Marking done closes the task for good, so it asks every time.
 */
export function TaskConfirm({
  action,
  title,
  pending,
  error,
  onConfirm,
  onClose,
}: {
  /** What was asked; null while nothing is. */
  action: TaskAction | null;
  title: string;
  pending: boolean;
  error: unknown;
  onConfirm: (action: TaskAction) => void;
  onClose: () => void;
}) {
  const t = useTranslations('confirm.task');
  // Keeps the words on screen while the dialog fades out.
  const shown = action ?? 'done';
  return (
    <ConfirmDialog
      open={action !== null}
      onOpenChange={(open) => !open && onClose()}
      title={t(`${shown}Title`)}
      text={t(`${shown}Text`, { title })}
      confirmLabel={t(`${shown}Yes`)}
      pending={pending}
      error={error}
      onConfirm={() => action && onConfirm(action)}
    />
  );
}
