'use client';

import { putPlan, type RouteView, type Timeline } from '@coal/shared';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ProblemMessage } from '@/components/problem-message';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useRefreshProject } from '@/lib/queries';
import { planKey, rolesOfStep } from '@/lib/timeline';

type Dates = { start: string; end: string };

/**
 * "Write the plan": while the Action Plan step is open, the Lead and the Head give each role its
 * start and end on every remaining step. The VP's sign-off makes the dates the baseline.
 */
export function PlanEditor({
  projectId,
  route,
  timeline,
}: {
  projectId: string;
  route: RouteView;
  timeline: Timeline;
}) {
  const t = useTranslations('timeline');
  const refresh = useRefreshProject(projectId);
  const firstKey = route.steps[0]?.key;

  // One row per remaining step and role: not the first step, not a finished one.
  const seen = new Set<string>();
  const rows = route.steps
    .filter(
      (s) =>
        s.key !== firstKey &&
        !['approved', 'done', 'cancelled', 'reset'].includes(s.status) &&
        !seen.has(s.key) &&
        !!seen.add(s.key),
    )
    .flatMap((step) => rolesOfStep(step).map((role) => ({ step, role })));

  // Prefilled from what is already written, or from the step's dates until then.
  const [values, setValues] = useState<Record<string, Dates>>(() => {
    const draft = new Map(timeline.draft.map((d) => [planKey(d.stepKey, d.roleKey), d]));
    return Object.fromEntries(
      rows.map(({ step, role }) => {
        const key = planKey(step.key, role.key);
        const written = draft.get(key);
        return [
          key,
          written
            ? { start: written.plannedStart, end: written.plannedEnd }
            : { start: step.plannedStart ?? '', end: step.plannedEnd ?? '' },
        ];
      }),
    );
  });
  const [saved, setSaved] = useState(false);

  const problemOf = (d: Dates | undefined) =>
    !d || (!d.start && !d.end)
      ? null
      : !d.start || !d.end
        ? 'both'
        : d.start > d.end
          ? 'order'
          : null;
  const filled = rows.filter(({ step, role }) => {
    const d = values[planKey(step.key, role.key)];
    return d?.start && d.end;
  });
  const hasProblem = rows.some(({ step, role }) => problemOf(values[planKey(step.key, role.key)]));

  const save = useMutation({
    mutationFn: () =>
      api(putPlan, {
        params: { id: projectId },
        body: {
          items: filled.map(({ step, role }) => {
            const d = values[planKey(step.key, role.key)] as Dates;
            return {
              stepKey: step.key,
              roleKey: role.key,
              plannedStart: d.start,
              plannedEnd: d.end,
            };
          }),
        },
      }),
    onSuccess: () => {
      setSaved(true);
      void refresh();
    },
  });

  const set = (key: string, field: keyof Dates, value: string) => {
    setSaved(false);
    setValues((v) => ({ ...v, [key]: { ...(v[key] ?? { start: '', end: '' }), [field]: value } }));
  };

  return (
    <section className="grid gap-3 rounded-xl border p-4" aria-labelledby="plan-heading">
      <div className="grid gap-1">
        <h3 id="plan-heading" className="font-medium">
          {t('writePlan')}
        </h3>
        <p className="text-sm text-muted-foreground">{t('writePlanText')}</p>
      </div>

      {route.stages.map((stage) => {
        const stageRows = rows.filter(({ step }) => step.stage === stage.no);
        if (stageRows.length === 0) return null;
        return (
          <div key={stage.no} className="grid gap-1">
            <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {t('stage', { no: stage.no, name: stage.name })}
            </h4>
            <ul className="grid gap-2 sm:gap-1">
              {stageRows.map(({ step, role }) => {
                const key = planKey(step.key, role.key);
                const d = values[key];
                const problem = problemOf(d);
                const label = `${step.key} ${step.name} · ${role.name}`;
                return (
                  <li
                    key={key}
                    className="grid gap-2 rounded-md border p-2 sm:grid-cols-[1fr_9.5rem_9.5rem] sm:items-center sm:border-0 sm:p-0"
                  >
                    <span className="text-sm">
                      <span className="font-mono text-xs text-muted-foreground">{step.key}</span>{' '}
                      {step.name} <span className="text-muted-foreground">· {role.name}</span>
                    </span>
                    <Input
                      type="date"
                      aria-label={t('startOf', { label })}
                      aria-invalid={problem !== null}
                      value={d?.start ?? ''}
                      onChange={(e) => set(key, 'start', e.target.value)}
                    />
                    <Input
                      type="date"
                      aria-label={t('endOf', { label })}
                      aria-invalid={problem !== null}
                      min={d?.start || undefined}
                      value={d?.end ?? ''}
                      onChange={(e) => set(key, 'end', e.target.value)}
                    />
                    {problem && (
                      <p role="alert" className="text-xs text-destructive sm:col-span-3">
                        {t(problem === 'both' ? 'needBoth' : 'endBeforeStart')}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}

      <ProblemMessage error={save.error} />
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={save.isPending || hasProblem} onClick={() => save.mutate()}>
          {t('savePlan')}
        </Button>
        <span className="text-sm text-muted-foreground" aria-live="polite">
          {saved
            ? t('planSaved', { count: filled.length })
            : t('planFilled', { count: filled.length })}
        </span>
      </div>
    </section>
  );
}
