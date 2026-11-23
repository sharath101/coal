'use client';

import { acceptTask, claimTask, declineTask, updateTask, type Task } from '@coal/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { AskAiLink } from '@/components/ask-ai';
import { RecordDeviationDialog } from '@/components/deviation-dialog';
import { ProblemMessage } from '@/components/problem-message';
import { RemindSigners, SignOffWaitText } from '@/components/remind-signers';
import { Pill } from '@/components/status-badge';
import { TaskConfirm, type TaskAction } from '@/components/task-confirm';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { isDeviationRequired } from '@/lib/deviation';
import { formatDate } from '@/lib/format';
import { queryKeys, useRefreshWork } from '@/lib/queries';

/**
 * One task, with what its person can do: claim from a queue, accept or decline a request, start
 * it, mark it done, ask for more time. A late task shows how late; one on the route's plan can't
 * be marked done until someone says why it is late, and the dialog for that comes up when the API
 * asks. `sent`: a task I gave someone, shown without their buttons.
 */
export function TaskRow({ task, sent = false }: { task: Task; sent?: boolean }) {
  const t = useTranslations('tasks');
  const tWait = useTranslations('signOffWait');
  const tWorkstation = useTranslations('workstation');
  const queryClient = useQueryClient();
  const refreshWork = useRefreshWork();
  const [deviation, setDeviation] = useState<'late' | 'time' | null>(null);
  const [declining, setDeclining] = useState(false);
  const [confirming, setConfirming] = useState<TaskAction | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.tasks });
  const claim = useMutation({
    mutationFn: () => api(claimTask, { params: { id: task.id } }),
    onSuccess: () => {
      setConfirming(null);
      void refresh();
    },
  });
  const accept = useMutation({
    mutationFn: () => api(acceptTask, { params: { id: task.id } }),
    onSuccess: () => {
      setConfirming(null);
      void refreshWork();
    },
  });
  const update = useMutation({
    mutationFn: (status: 'in_progress' | 'done') =>
      api(updateTask, { params: { id: task.id }, body: { status } }),
    onSuccess: () => {
      setConfirming(null);
      void refreshWork();
    },
    onError: (error, status) => {
      // A late task can't be closed until someone says why: ask now, then confirm again.
      if (status === 'done' && isDeviationRequired(error)) {
        setConfirming(null);
        setDeviation('late');
      }
    },
  });
  const confirmed = (action: TaskAction) => {
    if (action === 'claim') claim.mutate();
    else if (action === 'accept') accept.mutate();
    else update.mutate(action === 'start' ? 'in_progress' : 'done');
  };
  const closeConfirm = () => {
    setConfirming(null);
    claim.reset();
    accept.reset();
    update.reset();
  };
  const error = claim.error ?? accept.error ?? update.error;
  const queued = !task.assignee && task.queueRole;
  const open = ['open', 'in_progress', 'waiting'].includes(task.status);
  const unanswered = task.request?.state === 'pending';
  const busy = update.isPending || accept.isPending;
  // Handed in and with the signers: who it waits on matters, not this task's own date.
  const wait = task.status === 'waiting' ? task.waitingOn : null;

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
            {task.subject && ' · '}
            {task.stepKey && <>{t('step', { key: task.stepKey })} · </>}
            {t(`kind.${task.kind}`)}
            {queued && task.queueRole && <> · {t('queueFor', { role: task.queueRole.name })}</>}
            {(!open || task.status === 'waiting') && <> · {t(`status.${task.status}`)}</>}
            {open && !wait && task.dueOn && <> · {t('due', { date: formatDate(task.dueOn) })}</>}
          </span>
          {sent && task.assignee && (
            <span className="text-xs text-muted-foreground">
              {t('to', { name: task.assignee.name })}
              {task.request && task.request.state !== 'declined' && (
                <>
                  {' · '}
                  {t(task.request.state === 'pending' ? 'requestPending' : 'requestAccepted')}
                </>
              )}
            </span>
          )}
          {!sent && task.assignedBy && (
            <span className="text-xs text-muted-foreground">
              {t(task.viaAi ? 'fromViaAi' : 'from', { name: task.assignedBy.name })}
            </span>
          )}
          {task.request?.declineReason && (
            <span className="text-xs">
              {t('declinedBecause', { reason: task.request.declineReason })}
            </span>
          )}
          {wait && (
            <span className="text-xs text-muted-foreground">
              <SignOffWaitText wait={wait} />
            </span>
          )}
          {wait && wait.daysLate > 0 && (
            <span className="mt-1">
              <Pill tone="waiting">
                {tWait('lateBadge', { role: wait.signer.name, count: wait.daysLate })}
              </Pill>
            </span>
          )}
          {open && !wait && task.followsStep && (
            <span className="text-xs text-muted-foreground">
              {t(
                task.kind === 'sign'
                  ? 'followsStepSign'
                  : task.status === 'waiting'
                    ? 'followsStepWaiting'
                    : 'followsStepNote',
                { key: task.stepKey ?? '' },
              )}
            </span>
          )}
          {open && task.daysLate > 0 && (
            <span className="mt-1">
              <Pill tone="bad">{t('daysLate', { count: task.daysLate })}</Pill>
            </span>
          )}
        </div>
        {!sent && (
          <div className="flex shrink-0 flex-wrap gap-2">
            <AskAiLink
              pin={{
                taskId: task.id,
                ...(task.subject?.type === 'project' && { projectId: task.subject.id }),
              }}
              label={tWorkstation('openInWorkstation')}
            />
            {queued && open && (
              <Button size="sm" onClick={() => setConfirming('claim')} disabled={claim.isPending}>
                {t('claim')}
              </Button>
            )}
            {!queued && open && unanswered && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setDeclining(true)}
                  disabled={busy}
                >
                  {t('decline')}
                </Button>
                <Button size="sm" onClick={() => setConfirming('accept')} disabled={busy}>
                  {t('accept')}
                </Button>
              </>
            )}
            {!queued && open && !unanswered && task.followsStep && (
              <>
                {task.onPlan && task.status !== 'waiting' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setDeviation('time')}
                    disabled={busy}
                  >
                    {t('moreTime')}
                  </Button>
                )}
                {wait && task.subject && task.stepKey && (
                  <RemindSigners projectId={task.subject.id} stepKey={task.stepKey} wait={wait} />
                )}
                {task.subject && task.stepKey && (
                  <Button size="sm" asChild>
                    <Link
                      href={`/projects/${task.subject.id}?step=${encodeURIComponent(task.stepKey)}`}
                    >
                      {t('openStep', { key: task.stepKey })}
                    </Link>
                  </Button>
                )}
              </>
            )}
            {!queued && open && !unanswered && !task.followsStep && (
              <>
                {task.status === 'open' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setConfirming('start')}
                    disabled={busy}
                  >
                    {t('start')}
                  </Button>
                )}
                {task.onPlan && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setDeviation('time')}
                    disabled={busy}
                  >
                    {t('moreTime')}
                  </Button>
                )}
                <Button size="sm" onClick={() => setConfirming('done')} disabled={busy}>
                  {t('done')}
                </Button>
              </>
            )}
          </div>
        )}
      </div>
      <ProblemMessage error={deviation === 'late' || confirming ? null : error} />
      <TaskConfirm
        action={confirming}
        title={task.title}
        pending={claim.isPending || accept.isPending || update.isPending}
        error={error}
        onConfirm={confirmed}
        onClose={closeConfirm}
      />
      <RecordDeviationDialog
        open={deviation !== null}
        onOpenChange={(next) => !next && setDeviation(null)}
        tasks={[{ id: task.id, title: task.title }]}
        intro={deviation === 'late' ? t('lateIntro') : undefined}
        onRecorded={() => {
          if (deviation === 'late') setConfirming('done');
        }}
      />
      <DeclineDialog task={task} open={declining} onOpenChange={setDeclining} />
    </li>
  );
}

/** Declining a request needs a reason, which the person who asked sees on the task. */
function DeclineDialog({
  task,
  open,
  onOpenChange,
}: {
  task: Task;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('tasks');
  const id = useId();
  const refreshWork = useRefreshWork();
  const [reason, setReason] = useState('');
  const decline = useMutation({
    mutationFn: () => api(declineTask, { params: { id: task.id }, body: { reason } }),
    onSuccess: () => {
      onOpenChange(false);
      void refreshWork();
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle className="text-lg font-semibold">{t('declineTitle')}</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          {t('declineIntro', { name: task.assignedBy?.name ?? '' })}
        </DialogDescription>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            decline.mutate();
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor={`${id}-reason`}>{t('declineReason')}</Label>
            <Textarea
              id={`${id}-reason`}
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <ProblemMessage error={decline.error} />
          <div className="flex gap-2">
            <Button type="submit" disabled={decline.isPending || reason.trim().length < 3}>
              {t('decline')}
            </Button>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('cancel')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
