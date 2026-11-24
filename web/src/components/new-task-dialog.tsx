'use client';

import { createTask, type CreateTaskBody } from '@coal/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { ProblemMessage } from '@/components/problem-message';
import { selectClass } from '@/components/ui/select-class';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { todayIst } from '@/lib/format';
import { useMe, usePeople, useRefreshWork } from '@/lib/queries';

/**
 * A task for myself, work for someone below me, or a request to anyone else. The server decides
 * which from the reporting line, and the dialog shows its answer before saving.
 */
export function NewTaskDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('tasks');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle className="text-lg font-semibold">{t('newTitle')}</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          {t('newIntro')}
        </DialogDescription>
        {open && <NewTaskForm onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function NewTaskForm({ onDone }: { onDone: () => void }) {
  const t = useTranslations('tasks');
  const id = useId();
  const me = useMe();
  const people = usePeople();
  const refreshWork = useRefreshWork();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [dueOn, setDueOn] = useState('');
  const draft: CreateTaskBody = {
    title: title.trim().length >= 3 ? title : 'A new task',
    body,
    ...(assigneeId && { assigneeId }),
  };
  // What it would become, from the server's own rule.
  const preview = useQuery({
    queryKey: ['task-preview', assigneeId],
    queryFn: () => api(createTask, { query: { preview: 'true' }, body: draft }),
  });
  const save = useMutation({
    mutationFn: () =>
      api(createTask, {
        body: { ...draft, title, ...(dueOn && { dueOn }) },
      }),
    onSuccess: () => {
      void refreshWork();
      onDone();
    },
  });
  const kind = preview.data?.task.kind;
  const name = preview.data?.task.assignee?.name ?? '';

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor={`${id}-title`}>{t('fieldTitle')}</Label>
        <Input
          id={`${id}-title`}
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${id}-body`}>{t('fieldBody')}</Label>
        <Textarea
          id={`${id}-body`}
          value={body}
          maxLength={2000}
          onChange={(e) => setBody(e.target.value)}
        />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor={`${id}-person`}>{t('fieldPerson')}</Label>
          <select
            id={`${id}-person`}
            className={selectClass}
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
          >
            <option value="">{t('me')}</option>
            {(people.data ?? [])
              .filter((p) => p.id !== me.data?.id && p.status === 'active')
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.role.name}
                </option>
              ))}
          </select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${id}-due`}>{t('fieldDue')}</Label>
          <Input
            id={`${id}-due`}
            type="date"
            min={todayIst()}
            value={dueOn}
            onChange={(e) => setDueOn(e.target.value)}
          />
        </div>
      </div>
      {kind && (
        <p className="text-sm text-muted-foreground">
          {kind === 'own'
            ? t('becomesOwn')
            : kind === 'work'
              ? t('becomesWork', { name })
              : t('becomesRequest', { name })}
        </p>
      )}
      <ProblemMessage error={save.error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={save.isPending || title.trim().length < 3}>
          {t('send')}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t('cancel')}
        </Button>
      </div>
    </form>
  );
}
