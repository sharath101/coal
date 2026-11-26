'use client';

import {
  recordPrerequisite,
  type ActionResult,
  type PrerequisiteView,
  type RouteView,
} from '@coal/shared';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ActionConfirm } from '@/components/action-confirm';
import { ProblemMessage } from '@/components/problem-message';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';

/**
 * The prerequisites a step's card shows: those recorded at the step, and one recorded any time (the
 * test licence) on the steps it holds up. It is recorded from the first of them, so it is asked once.
 */
export function prerequisitesOfStep(route: RouteView, stepKey: string) {
  return route.prerequisites.flatMap((p) => {
    if (p.recordedAt === stepKey) return [{ prerequisite: p, recordHere: true }];
    if (p.recordedAt === null && p.holdsUp.includes(stepKey)) {
      return [{ prerequisite: p, recordHere: p.holdsUp[0] === stepKey }];
    }
    return [];
  });
}

/** Whether this person can record one of the step's prerequisites now: the card opens for it. */
export const canRecordAtStep = (route: RouteView, stepKey: string) =>
  prerequisitesOfStep(route, stepKey).some((p) => p.recordHere && p.prerequisite.canRecord);

function PrerequisiteRow({
  projectId,
  prerequisite,
  recordHere,
  onChanged,
}: {
  projectId: string;
  prerequisite: PrerequisiteView;
  recordHere: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations('step');
  const tConfirm = useTranslations('confirm.prerequisite');
  const [note, setNote] = useState('');
  const [asked, setAsked] = useState<ActionResult | null>(null);
  const request = {
    params: { id: projectId },
    body: { prerequisite: prerequisite.key, ...(note.trim() && { note: note.trim() }) },
  };
  // Recording changes what the route waits for, so the API says what would happen and the person confirms.
  const previewIt = useMutation({
    mutationFn: () => api(recordPrerequisite, { ...request, query: { preview: 'true' } }),
    onSuccess: setAsked,
  });
  const mutation = useMutation({
    mutationFn: () => api(recordPrerequisite, request),
    onSuccess: () => {
      setNote('');
      setAsked(null);
      onChanged();
    },
  });
  const roles = prerequisite.recordedBy.map((r) => r.name).join(', ');

  return (
    <li className="grid gap-2 rounded-md border p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="grid gap-0.5">
          <span className="font-medium">{prerequisite.name}</span>
          <span className="text-xs text-muted-foreground">
            {t('prerequisiteBy', { roles })}
            {prerequisite.holdsUp.length > 0 &&
              ` · ${t('prerequisiteHoldsUp', {
                count: prerequisite.holdsUp.length,
                steps: prerequisite.holdsUp.join(', '),
              })}`}
          </span>
        </div>
        <span className={prerequisite.reached ? 'font-medium' : 'text-muted-foreground'}>
          {prerequisite.reached ? t('prerequisiteRecorded') : t('prerequisiteWaiting')}
        </span>
      </div>
      {recordHere && prerequisite.canRecord && (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            previewIt.mutate();
          }}
        >
          <Input
            aria-label={t('prerequisiteNote')}
            placeholder={t('prerequisiteNote')}
            maxLength={1000}
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              setAsked(null);
            }}
            className="max-w-sm"
          />
          <Button type="submit" size="sm" disabled={previewIt.isPending || mutation.isPending}>
            {t('recordPrerequisite')}
          </Button>
        </form>
      )}
      {asked && (
        <ActionConfirm
          title={tConfirm('title', { name: prerequisite.name })}
          text={tConfirm('text')}
          confirmLabel={tConfirm('yes')}
          preview={asked.preview}
          busy={mutation.isPending}
          onConfirm={() => mutation.mutate()}
          onCancel={() => setAsked(null)}
        />
      )}
      <ProblemMessage error={previewIt.error ?? mutation.error} />
    </li>
  );
}

/**
 * Facts a person records that steps wait for, such as "material received", shown on the step they
 * belong to (docs/workflow.md#starting-steps). Not the project's milestones.
 */
export function StepPrerequisites({
  projectId,
  stepKey,
  route,
  onChanged,
}: {
  projectId: string;
  stepKey: string;
  route: RouteView;
  onChanged: () => void;
}) {
  const t = useTranslations('step');
  const items = prerequisitesOfStep(route, stepKey);
  if (items.length === 0) return null;
  return (
    <div className="grid gap-1">
      <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {t('prerequisites')}
      </h4>
      <ul className="grid gap-2">
        {items.map(({ prerequisite, recordHere }) => (
          <PrerequisiteRow
            key={prerequisite.key}
            projectId={projectId}
            prerequisite={prerequisite}
            recordHere={recordHere}
            onChanged={onChanged}
          />
        ))}
      </ul>
    </div>
  );
}
