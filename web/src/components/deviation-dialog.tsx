'use client';

import { recordDeviation, type Deviation } from '@coal/shared';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import {
  DeviationFields,
  draftBody,
  draftComplete,
  emptyDraft,
} from '@/components/deviation-fields';
import { ProblemMessage } from '@/components/problem-message';
import { selectClass } from '@/components/ui/select-class';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { useRefreshWork } from '@/lib/queries';

export interface DeviationTask {
  id: string;
  title: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The tasks it can be recorded for; the person picks when there is more than one. */
  tasks: DeviationTask[];
  /** Said above the form, such as why the dialog came up. */
  intro?: string;
  /** Called once the deviation is recorded, such as to try again what was refused. */
  onRecorded?: (deviation: Deviation) => void;
}

/** "Record why it is late": the reason, the cause and the new expected date (docs/dashboard.md). */
export function RecordDeviationDialog({ open, onOpenChange, tasks, intro, onRecorded }: Props) {
  const t = useTranslations('deviation');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle className="text-lg font-semibold">{t('title')}</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          {intro ?? t('intro')}
        </DialogDescription>
        <RecordForm
          tasks={tasks}
          onCancel={() => onOpenChange(false)}
          onRecorded={(deviation) => {
            onOpenChange(false);
            onRecorded?.(deviation);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function RecordForm({
  tasks,
  onCancel,
  onRecorded,
}: {
  tasks: DeviationTask[];
  onCancel: () => void;
  onRecorded: (deviation: Deviation) => void;
}) {
  const t = useTranslations('deviation');
  const id = useId();
  const refresh = useRefreshWork();
  const [taskId, setTaskId] = useState(tasks[0]?.id ?? '');
  const [draft, setDraft] = useState(emptyDraft);
  const record = useMutation({
    mutationFn: () => api(recordDeviation, { body: { taskId, ...draftBody(draft) } }),
    onSuccess: (deviation) => {
      void refresh();
      onRecorded(deviation);
    },
  });

  if (tasks.length === 0) return <p className="text-sm text-muted-foreground">{t('noTask')}</p>;
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        record.mutate();
      }}
    >
      {tasks.length > 1 && (
        <div className="grid gap-2">
          <Label htmlFor={`${id}-task`}>{t('task')}</Label>
          <select
            id={`${id}-task`}
            className={selectClass}
            value={taskId}
            onChange={(e) => setTaskId(e.target.value)}
          >
            {tasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.title}
              </option>
            ))}
          </select>
        </div>
      )}
      <DeviationFields idPrefix={id} draft={draft} onChange={setDraft} />
      <ProblemMessage error={record.error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={record.isPending || !taskId || !draftComplete(draft)}>
          {t('record')}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t('cancel')}
        </Button>
      </div>
    </form>
  );
}
