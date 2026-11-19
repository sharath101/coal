import { z } from 'zod';
import { directInputs, type RouteDefinition, type StepKey } from '../process/definition';
import { FINISHED_STATUSES, OPEN_STATUSES, type StepStatus } from '../process/engine';
import type { HealthReason } from '../schemas/common';
import {
  addWorkingDays,
  calendarDaysBetween,
  maxDate,
  minDate,
  workingDaysBetween,
  type DateKey,
  type WorkCalendar,
} from './calendar';

/**
 * Dates, the forecast and health (docs/dashboard.md). Pure functions: the backend loads the
 * facts, calls these and stores the answers, so the website and the tests see the same maths.
 */

const days = (fallback: number) => z.number().int().min(0).max(365).default(fallback);

/** Every threshold and timing is a setting, not code (docs/dashboard.md). */
export const ScheduleSettings = z.object({
  /** A step is at risk when it is due within this many working days and not started. */
  atRiskWorkingDays: days(2),
  /** A step is at risk when a signature on it has waited longer than this. */
  signatureWaitWorkingDays: days(3),
  /** How long a signer is given from the request. */
  signatureDueWorkingDays: days(3),
  /** A project is red when its forecast launch is later than planned by more than this (calendar days). */
  redSlipDays: days(30),
  /** A project is red when a step is overdue by more than this many working days. */
  redOverdueWorkingDays: days(10),
  /** The first reminder goes this many working days before the due date. */
  reminderBeforeWorkingDays: days(2),
  /** Late by this many working days: tell the next role up. */
  escalateToLadderWorkingDays: days(2),
  /** Late by this many working days: onto the weekly exception list. */
  escalateToExceptionListWorkingDays: days(5),
  /** A waiting signature is reminded about every this many working days. */
  signatureReminderEveryWorkingDays: days(2),
  /** A corrective action is due this many working days after it is raised. */
  correctiveActionDueWorkingDays: days(10),
});
export type ScheduleSettings = z.infer<typeof ScheduleSettings>;
export const SCHEDULE_DEFAULTS: ScheduleSettings = ScheduleSettings.parse({});

/** What the schedule needs to know about one step's current iteration. */
export interface StepFacts {
  status: StepStatus;
  openedOn: DateKey | null;
  submittedOn: DateKey | null;
  completedOn: DateKey | null;
  /** From the baseline and later changes: the earliest start and the latest end across roles. */
  plan: { start: DateKey; end: DateKey } | null;
  /** The newest date a doer gave in a deviation for this step. */
  expectedEnd: DateKey | null;
}

export type StepHealth = 'ok' | 'at_risk' | 'overdue';

export interface StepSchedule {
  plannedStart: DateKey | null;
  plannedEnd: DateKey | null;
  forecastStart: DateKey;
  forecastEnd: DateKey;
  /** Null for finished and not-required steps. */
  health: StepHealth | null;
  /** Working days past the planned end, while the step is unfinished. */
  daysLate: number;
}

export interface RunSchedule {
  steps: Record<StepKey, StepSchedule>;
  forecastLaunch: DateKey | null;
}

export interface ScheduleOptions {
  today: DateKey;
  /** The day the run started: where the first step's clock starts. */
  startedOn: DateKey;
  cal: WorkCalendar;
  settings: ScheduleSettings;
}

const isFinished = (s: StepStatus) => FINISHED_STATUSES.includes(s);
const isOpen = (s: StepStatus) => OPEN_STATUSES.includes(s);

/** The step whose approval ends the run (for R&D, step 25: the launch). */
export function launchStepKey(route: RouteDefinition): StepKey | null {
  const done = route.run.completed_when;
  return 'step_approved' in done ? done.step_approved : 'step_done' in done ? done.step_done : null;
}

/**
 * Plans every step. A step's length is the baseline's, where there is one, and otherwise the
 * route's default in working days. An open step's expected end is its start plus that length,
 * moved later by a deviation's new date and never into the past. A waiting step starts when its
 * inputs are expected to end.
 */
export function scheduleRun(
  route: RouteDefinition,
  facts: Record<StepKey, StepFacts>,
  options: ScheduleOptions,
): RunSchedule {
  const { today, startedOn, cal, settings } = options;
  const result: Record<StepKey, StepSchedule> = {};
  const byKey = new Map(route.steps.map((s) => [s.key, s]));

  const compute = (key: StepKey): StepSchedule => {
    const known = result[key];
    if (known) return known;
    const step = byKey.get(key);
    const f = facts[key];
    if (!step || !f) throw new Error(`No facts for step ${key}`);

    const inputEnds = directInputs(route, step).map((k) => compute(k).forecastEnd);
    const inputsEnd = maxDate(inputEnds) ?? startedOn;
    const length = f.plan
      ? Math.max(0, workingDaysBetween(cal, f.plan.start, f.plan.end))
      : step.default_days;

    let forecastStart: DateKey;
    let forecastEnd: DateKey;
    if (f.status === 'cancelled') {
      forecastStart = inputsEnd;
      forecastEnd = inputsEnd;
    } else if (isFinished(f.status)) {
      forecastStart = f.openedOn ?? inputsEnd;
      forecastEnd = f.completedOn ?? today;
    } else if (isOpen(f.status)) {
      forecastStart = f.openedOn ?? today;
      const worked = addWorkingDays(cal, forecastStart, length);
      const asked = f.expectedEnd ?? forecastStart;
      forecastEnd =
        f.status === 'in_review' && f.submittedOn
          ? (maxDate([
              today,
              asked,
              addWorkingDays(cal, f.submittedOn, settings.signatureDueWorkingDays),
            ]) as DateKey)
          : (maxDate([today, asked, worked]) as DateKey);
    } else {
      forecastStart = maxDate([inputsEnd, today]) as DateKey;
      forecastEnd = maxDate([
        addWorkingDays(cal, forecastStart, length),
        f.expectedEnd ?? forecastStart,
      ]) as DateKey;
    }

    let plannedStart: DateKey | null = f.plan?.start ?? null;
    let plannedEnd: DateKey | null = f.plan?.end ?? null;
    if (!f.plan && f.openedOn && f.status !== 'cancelled') {
      plannedStart = f.openedOn;
      plannedEnd = addWorkingDays(cal, f.openedOn, step.default_days);
    }

    let health: StepHealth | null = null;
    let daysLate = 0;
    if (!isFinished(f.status) && f.status !== 'cancelled') {
      health = 'ok';
      if (plannedEnd && today > plannedEnd) {
        health = 'overdue';
        daysLate = workingDaysBetween(cal, plannedEnd, today);
      } else if (plannedEnd) {
        const soon = workingDaysBetween(cal, today, plannedEnd) <= settings.atRiskWorkingDays;
        // The signer's window isn't the doers' slip: a handed-in step is judged by the signature rule.
        const slipping = f.status !== 'in_review' && forecastEnd > plannedEnd;
        const unsigned =
          f.status === 'in_review' &&
          f.submittedOn !== null &&
          workingDaysBetween(cal, f.submittedOn, today) > settings.signatureWaitWorkingDays;
        if (slipping || (f.status === 'ready' && soon) || unsigned) health = 'at_risk';
      } else if (
        f.status === 'in_review' &&
        f.submittedOn !== null &&
        workingDaysBetween(cal, f.submittedOn, today) > settings.signatureWaitWorkingDays
      ) {
        health = 'at_risk';
      }
    }

    const done: StepSchedule = {
      plannedStart,
      plannedEnd,
      forecastStart,
      forecastEnd,
      health,
      daysLate,
    };
    result[key] = done;
    return done;
  };

  route.steps.forEach((s) => compute(s.key));
  const launch = launchStepKey(route);
  return {
    steps: result,
    forecastLaunch: launch ? (result[launch]?.forecastEnd ?? null) : null,
  };
}

/** The launch date a new run is planned for, from the route's default lengths. */
export function defaultLaunch(
  route: RouteDefinition,
  startedOn: DateKey,
  cal: WorkCalendar,
  settings: ScheduleSettings = SCHEDULE_DEFAULTS,
): DateKey | null {
  const facts: Record<StepKey, StepFacts> = {};
  for (const step of route.steps) {
    facts[step.key] = {
      status: step.done_at_go ? 'done' : 'locked',
      openedOn: step.done_at_go ? startedOn : null,
      submittedOn: null,
      completedOn: step.done_at_go ? startedOn : null,
      plan: null,
      expectedEnd: null,
    };
  }
  return scheduleRun(route, facts, { today: startedOn, startedOn, cal, settings }).forecastLaunch;
}

/** The plan of each step from baseline or change rows, which are per role. */
export function planOfSteps(
  items: readonly { stepKey: StepKey; plannedStart: DateKey; plannedEnd: DateKey }[],
): Record<StepKey, { start: DateKey; end: DateKey }> {
  const grouped = new Map<StepKey, { starts: DateKey[]; ends: DateKey[] }>();
  for (const item of items) {
    const entry = grouped.get(item.stepKey) ?? { starts: [], ends: [] };
    entry.starts.push(item.plannedStart);
    entry.ends.push(item.plannedEnd);
    grouped.set(item.stepKey, entry);
  }
  const plan: Record<StepKey, { start: DateKey; end: DateKey }> = {};
  for (const [key, { starts, ends }] of grouped) {
    plan[key] = { start: minDate(starts) as DateKey, end: maxDate(ends) as DateKey };
  }
  return plan;
}

export type Health = 'green' | 'amber' | 'red';

/**
 * Red: a checkpoint is overdue, the forecast launch is more than 30 days past plan, or a step is
 * more than 10 working days overdue. Amber: any step at risk or overdue. Otherwise green.
 */
export function projectHealth(
  route: RouteDefinition,
  schedule: RunSchedule,
  options: { plannedLaunch: DateKey | null; settings: ScheduleSettings },
): { health: Health; reasons: HealthReason[] } {
  const { plannedLaunch, settings } = options;
  const red: HealthReason[] = [];
  const amber: HealthReason[] = [];

  for (const step of route.steps) {
    const s = schedule.steps[step.key];
    if (!s?.health || s.health === 'ok') continue;
    if (s.health === 'overdue') {
      if (step.checkpoint) red.push({ code: 'checkpoint_overdue', step: step.key });
      if (s.daysLate > settings.redOverdueWorkingDays) {
        red.push({ code: 'step_far_overdue', step: step.key, days: s.daysLate });
      }
      amber.push({ code: 'step_overdue', step: step.key, days: s.daysLate });
    } else {
      amber.push({ code: 'step_at_risk', step: step.key });
    }
  }
  if (plannedLaunch && schedule.forecastLaunch) {
    const slip = calendarDaysBetween(plannedLaunch, schedule.forecastLaunch);
    if (slip > settings.redSlipDays) red.push({ code: 'launch_slipped', days: slip });
  }
  if (red.length > 0) return { health: 'red', reasons: red };
  if (amber.length > 0) return { health: 'amber', reasons: amber };
  return { health: 'green', reasons: [] };
}
