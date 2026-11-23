import {
  calendarDaysBetween,
  dateOfInstant,
  launchStepKey,
  workingDaysBetween,
  type HealthReason,
  type Timeline,
} from '@coal/shared';
import type { Executor } from '../../core/db/client';
import { explainedSteps } from '../deviations/store';
import { currentSteps, getRuns } from '../process/service';
import { canSeeProjectContent, may } from '../rnd/env';
import { findUsersByIds } from '../users/service';
import { loadCalendar } from './calendar';
import { splitItems, timelineRows, type TimelineRow } from './service';
import type { Env } from '../rnd/actions';

/** The step doers can write the plan in: open, and not under review. */
export const PLAN_EDITABLE = ['ready', 'in_progress', 'returned'];

export async function presentTimeline(ex: Executor, env: Env, now: Date): Promise<Timeline> {
  const { route, state } = env.loaded;
  const [runs, rows, cal, items] = await Promise.all([
    getRuns(ex, env.orgId, [env.loaded.run.id]),
    currentSteps(ex, env.loaded.run.id),
    loadCalendar(ex, env.orgId),
    timelineRows(ex, env.loaded.run.id),
  ]);
  const run = runs.get(env.loaded.run.id) ?? env.loaded.run;
  const explained = await explainedSteps(
    ex,
    rows.map((r) => r.id),
    dateOfInstant(now),
  );
  const people = await findUsersByIds(ex, env.orgId, [...new Set(items.map((i) => i.recordedBy))]);
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const today = dateOfInstant(now);
  const rowOf = new Map(rows.map((r) => [r.stepKey, r]));
  const { draft, baseline, changes } = splitItems(items);
  const view = (r: TimelineRow) => ({
    id: r.id,
    kind: r.kind,
    baselineNo: r.baselineNo,
    stepKey: r.stepKey,
    roleKey: r.roleKey,
    plannedStart: r.plannedStart,
    plannedEnd: r.plannedEnd,
    // A reason for changing a date is content: shown to the project's scope only.
    reason: canSeeProjectContent(env) ? r.reason : null,
    recordedBy: nameOf.get(r.recordedBy) ?? 'Unknown',
    createdAt: r.createdAt.toISOString(),
  });

  const planStep = route.steps.find((s) => s.baseline);
  const launch = launchStepKey(route);
  return {
    projectId: env.project.id,
    today,
    baselineNo: run.baselineNo,
    plannedLaunch: run.plannedLaunch,
    forecastLaunch: run.forecastLaunch,
    slipDays:
      run.plannedLaunch && run.forecastLaunch
        ? calendarDaysBetween(run.plannedLaunch, run.forecastLaunch)
        : null,
    health: run.health,
    healthReasons: run.healthReasons as HealthReason[],
    planStep: planStep?.key ?? null,
    steps: route.steps.map((step) => {
      const row = rowOf.get(step.key);
      const status = state.steps[step.key]?.status ?? 'locked';
      const unfinished = !['approved', 'done', 'cancelled'].includes(status);
      const pastDue = !!row?.plannedEnd && unfinished && today > row.plannedEnd;
      return {
        key: step.key,
        name: step.name,
        stage: step.stage,
        status,
        plannedStart: row?.plannedStart ?? null,
        plannedEnd: row?.plannedEnd ?? null,
        forecastStart: row?.forecastStart ?? null,
        forecastEnd: row?.forecastEnd ?? null,
        health: unfinished ? (pastDue ? ('overdue' as const) : (row?.health ?? null)) : null,
        daysLate: pastDue && row?.plannedEnd ? workingDaysBetween(cal, row.plannedEnd, today) : 0,
        // Once handed in, the wait is the signers': the doers have nothing left to explain.
        needsDeviation: pastDue && status !== 'in_review' && !!row && !explained.has(row.id),
      };
    }),
    draft: draft.map(view),
    items: [...baseline, ...changes].map(view),
    can: {
      editPlan:
        !!planStep &&
        PLAN_EDITABLE.includes(state.steps[planStep.key]?.status ?? '') &&
        ['active'].includes(state.status) &&
        may(env, 'timeline.plan', planStep.doers),
      change: run.baselineNo >= 1 && may(env, 'timeline.change', ['rd_head', 'vp']),
      changeLaunch: !!launch && run.baselineNo >= 1 && may(env, 'timeline.change', ['vp']),
    },
  };
}
