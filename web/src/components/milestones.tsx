'use client';

import { recordMilestone, type RouteView } from '@coal/shared';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ProblemMessage } from '@/components/problem-message';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';

type Milestone = RouteView['milestones'][number];

function MilestoneRow({
  projectId,
  milestone,
  onChanged,
}: {
  projectId: string;
  milestone: Milestone;
  onChanged: () => void;
}) {
  const t = useTranslations('project');
  const [note, setNote] = useState('');
  const mutation = useMutation({
    mutationFn: () =>
      api(recordMilestone, {
        params: { id: projectId },
        body: { milestone: milestone.key, ...(note.trim() && { note: note.trim() }) },
      }),
    onSuccess: () => {
      setNote('');
      onChanged();
    },
  });

  return (
    <li className="grid gap-2 rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="grid gap-0.5">
          <span className="font-medium">{milestone.name}</span>
          <span className="text-xs text-muted-foreground">
            {milestone.recordedAt
              ? t('recordedAt', { step: milestone.recordedAt })
              : t('recordedAnytime')}{' '}
            · {milestone.recordedBy.map((r) => r.name).join(', ')}
          </span>
        </div>
        <span className={milestone.reached ? 'font-medium' : 'text-muted-foreground'}>
          {milestone.reached ? t('milestoneReached') : t('milestoneWaiting')}
        </span>
      </div>
      {milestone.canRecord && (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <Input
            aria-label={t('note')}
            placeholder={t('note')}
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="max-w-sm"
          />
          <Button type="submit" size="sm" disabled={mutation.isPending}>
            {t('record')}
          </Button>
        </form>
      )}
      <ProblemMessage error={mutation.error} />
    </li>
  );
}

/** Milestones are facts a person records, with a note, until some come from records (docs/workflow.md#starting-steps). */
export function Milestones({
  projectId,
  route,
  onChanged,
}: {
  projectId: string;
  route: RouteView;
  onChanged: () => void;
}) {
  const t = useTranslations('project');
  return (
    <section className="grid gap-3">
      <h2 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
        {t('milestones')}
      </h2>
      <ul className="grid gap-2">
        {route.milestones.map((m) => (
          <MilestoneRow key={m.key} projectId={projectId} milestone={m} onChanged={onChanged} />
        ))}
      </ul>
    </section>
  );
}
