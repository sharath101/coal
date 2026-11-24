'use client';

import { changeDates, launchStepKey, type RouteView, type Timeline } from '@coal/shared';
import { useMutation } from '@tanstack/react-query';
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
import { useProcess, useRefreshProject } from '@/lib/queries';
import { currentDates, isPlannable, planKey, rolesOfStep } from '@/lib/timeline';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  route: RouteView;
  timeline: Timeline;
}

/** "Change a date" after the baseline: the Head, or the VP for the launch step. Recorded with a reason. */
export function ChangeDatesDialog({ open, onOpenChange, ...rest }: Props) {
  const t = useTranslations('timeline');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle className="text-lg font-semibold">{t('changeTitle')}</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          {t('changeText')}
        </DialogDescription>
        <ChangeForm {...rest} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function ChangeForm({
  projectId,
  route,
  timeline,
  onClose,
}: Omit<Props, 'open' | 'onOpenChange'> & { onClose: () => void }) {
  const t = useTranslations('timeline');
  const id = useId();
  const refresh = useRefreshProject(projectId);
  const process = useProcess(route.process);
  const launch = process.data ? launchStepKey(process.data) : null;

  // Only the VP changes the launch step; the API refuses anyone else.
  const seen = new Set<string>();
  const steps = route.steps.filter(
    (s) =>
      isPlannable(s) &&
      rolesOfStep(s).length > 0 &&
      (timeline.can.changeLaunch || s.key !== launch) &&
      !seen.has(s.key) &&
      !!seen.add(s.key),
  );
  const current = currentDates(timeline.items);

  const datesFor = (stepKey: string, roleKey: string) => {
    const step = steps.find((s) => s.key === stepKey);
    const known = current.get(planKey(stepKey, roleKey));
    return known ?? { start: step?.plannedStart ?? '', end: step?.plannedEnd ?? '' };
  };
  const firstStep = steps[0];
  const firstRole = firstStep ? rolesOfStep(firstStep)[0] : undefined;
  const [stepKey, setStepKey] = useState(firstStep?.key ?? '');
  const [roleKey, setRoleKey] = useState(firstRole?.key ?? '');
  const [dates, setDates] = useState(() =>
    firstStep && firstRole ? datesFor(firstStep.key, firstRole.key) : { start: '', end: '' },
  );
  const [reason, setReason] = useState('');

  const step = steps.find((s) => s.key === stepKey);
  const roles = step ? rolesOfStep(step) : [];

  const pickStep = (key: string) => {
    const next = steps.find((s) => s.key === key);
    const role = next ? rolesOfStep(next)[0] : undefined;
    setStepKey(key);
    setRoleKey(role?.key ?? '');
    if (role) setDates(datesFor(key, role.key));
  };
  const pickRole = (key: string) => {
    setRoleKey(key);
    setDates(datesFor(stepKey, key));
  };

  const save = useMutation({
    mutationFn: () =>
      api(changeDates, {
        params: { id: projectId },
        body: {
          stepKey,
          roleKey,
          plannedStart: dates.start,
          plannedEnd: dates.end,
          reason: reason.trim(),
        },
      }),
    onSuccess: () => {
      void refresh();
      onClose();
    },
  });
  const orderOk = !dates.start || !dates.end || dates.start <= dates.end;
  const complete =
    !!stepKey && !!roleKey && !!dates.start && !!dates.end && orderOk && reason.trim().length >= 3;

  if (steps.length === 0)
    return <p className="text-sm text-muted-foreground">{t('nothingToChange')}</p>;
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor={`${id}-step`}>{t('step')}</Label>
        <select
          id={`${id}-step`}
          className={selectClass}
          value={stepKey}
          onChange={(e) => pickStep(e.target.value)}
        >
          {steps.map((s) => (
            <option key={s.key} value={s.key}>
              {s.key} · {s.name}
            </option>
          ))}
        </select>
        {!timeline.can.changeLaunch && launch && (
          <p className="text-xs text-muted-foreground">{t('onlyVpLaunch', { step: launch })}</p>
        )}
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${id}-role`}>{t('role')}</Label>
        <select
          id={`${id}-role`}
          className={selectClass}
          value={roleKey}
          onChange={(e) => pickRole(e.target.value)}
        >
          {roles.map((r) => (
            <option key={r.key} value={r.key}>
              {r.name}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor={`${id}-start`}>{t('start')}</Label>
          <Input
            id={`${id}-start`}
            type="date"
            required
            value={dates.start}
            onChange={(e) => setDates({ ...dates, start: e.target.value })}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${id}-end`}>{t('end')}</Label>
          <Input
            id={`${id}-end`}
            type="date"
            required
            min={dates.start || undefined}
            aria-invalid={!orderOk}
            value={dates.end}
            onChange={(e) => setDates({ ...dates, end: e.target.value })}
          />
        </div>
      </div>
      {!orderOk && (
        <p role="alert" className="text-sm text-destructive">
          {t('endBeforeStart')}
        </p>
      )}
      <div className="grid gap-2">
        <Label htmlFor={`${id}-reason`}>{t('reason')}</Label>
        <Textarea
          id={`${id}-reason`}
          required
          minLength={3}
          maxLength={500}
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      <ProblemMessage error={save.error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={save.isPending || !complete}>
          {t('saveChange')}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          {t('cancel')}
        </Button>
      </div>
    </form>
  );
}
