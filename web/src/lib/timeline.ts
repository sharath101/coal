import { FINISHED_STATUSES, type StepView, type Timeline } from '@coal/shared';

export type RoleRef = StepView['doers'][number];

/** The roles that have a part in a step and can be given dates: its doers and its signer. */
export function rolesOfStep(step: Pick<StepView, 'doers' | 'signer'>): RoleRef[] {
  const all = [...step.doers, ...(step.signer ? [step.signer] : [])];
  const seen = new Set<string>();
  // "team" stands for the project team, not for a role that can be given a date.
  return all.filter((r) => r.key !== 'team' && !seen.has(r.key) && !!seen.add(r.key));
}

export const planKey = (stepKey: string, roleKey: string) => `${stepKey}|${roleKey}`;

/** What still has dates to write or change: the step is not finished, cancelled or reset. */
export const isPlannable = (step: Pick<StepView, 'status'>) =>
  !([...FINISHED_STATUSES, 'cancelled', 'reset'] as string[]).includes(step.status);

/** The latest planned dates of each step and role: the baseline, then every change after it. */
export function currentDates(items: Timeline['items']) {
  const current = new Map<string, { start: string; end: string }>();
  for (const item of items) {
    current.set(planKey(item.stepKey, item.roleKey), {
      start: item.plannedStart,
      end: item.plannedEnd,
    });
  }
  return current;
}
