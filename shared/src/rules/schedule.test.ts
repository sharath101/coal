import { describe, expect, it } from 'vitest';
import { loadRoute } from '../process/files';
import type { StepKey } from '../process/definition';
import { makeCalendar } from './calendar';
import {
  SCHEDULE_DEFAULTS,
  defaultLaunch,
  planOfSteps,
  projectHealth,
  scheduleRun,
  type StepFacts,
} from './schedule';

const route = loadRoute('rnd-route', 2);
const cal = makeCalendar();
const options = (today: string, startedOn = '2026-11-02') => ({
  today,
  startedOn,
  cal,
  settings: SCHEDULE_DEFAULTS,
});

/** Every step waiting, except the idea, which is done on the first day. */
function facts(overrides: Record<StepKey, Partial<StepFacts>> = {}): Record<StepKey, StepFacts> {
  const all: Record<StepKey, StepFacts> = {};
  for (const step of route.steps) {
    all[step.key] = {
      status: step.done_at_go ? 'done' : 'locked',
      openedOn: step.done_at_go ? '2026-11-02' : null,
      submittedOn: null,
      completedOn: step.done_at_go ? '2026-11-02' : null,
      plan: null,
      expectedEnd: null,
      ...overrides[step.key],
    };
  }
  return all;
}

describe('the default launch date', () => {
  it('follows the longest path of default lengths', () => {
    const launch = defaultLaunch(route, '2026-11-02', cal);
    expect(launch).not.toBeNull();
    expect((launch as string) > '2027-06-01').toBe(true);
  });

  it('moves later when a holiday falls in the way', () => {
    const base = defaultLaunch(route, '2026-11-02', cal) as string;
    const holidays = makeCalendar([
      { date: '2026-11-03', isWorkingDay: false },
      { date: '2026-11-04', isWorkingDay: false },
    ]);
    expect((defaultLaunch(route, '2026-11-02', holidays) as string) > base).toBe(true);
  });
});

describe('steps', () => {
  it('plans an open step from the day it opened: opened Monday, 5 days, due next Monday', () => {
    const run = scheduleRun(
      route,
      facts({ '1': { status: 'in_progress', openedOn: '2026-11-02' } }),
      options('2026-11-04'),
    );
    expect(run.steps['1']).toMatchObject({
      plannedStart: '2026-11-02',
      plannedEnd: '2026-11-09',
      forecastEnd: '2026-11-09',
      health: 'ok',
      daysLate: 0,
    });
  });

  it('is overdue the day after the planned end, and counts working days late', () => {
    const run = scheduleRun(
      route,
      facts({ '1': { status: 'in_progress', openedOn: '2026-11-02' } }),
      options('2026-11-12'),
    );
    expect(run.steps['1']).toMatchObject({ health: 'overdue', daysLate: 3 });
    expect(run.steps['1']?.forecastEnd).toBe('2026-11-12');
  });

  it('is at risk when it is due within 2 working days and not started', () => {
    const f = facts({ '1': { status: 'ready', openedOn: '2026-11-02' } });
    expect(scheduleRun(route, f, options('2026-11-04')).steps['1']?.health).toBe('ok');
    expect(scheduleRun(route, f, options('2026-11-05')).steps['1']?.health).toBe('at_risk');
  });

  it('is at risk when a signature has waited more than 3 working days', () => {
    const f = facts({
      '1': { status: 'in_review', openedOn: '2026-11-02', submittedOn: '2026-11-03' },
    });
    expect(scheduleRun(route, f, options('2026-11-06')).steps['1']?.health).toBe('ok');
    expect(scheduleRun(route, f, options('2026-11-09')).steps['1']?.health).toBe('at_risk');
  });

  it('is not at risk just because it was handed in near its planned end', () => {
    // Opened Monday 2 Nov, planned end Monday 9 Nov; handed in Friday 6 Nov, with its signer.
    const f = facts({
      '1': { status: 'in_review', openedOn: '2026-11-02', submittedOn: '2026-11-06' },
    });
    const run = scheduleRun(route, f, options('2026-11-06'));
    expect(run.steps['1']?.health).toBe('ok');
    expect(
      projectHealth(route, run, { plannedLaunch: null, settings: SCHEDULE_DEFAULTS }).health,
    ).toBe('green');
  });

  it("takes a doer's new date into the forecast, and pushes what waits for it", () => {
    const before = scheduleRun(
      route,
      facts({ '1': { status: 'in_progress', openedOn: '2026-11-02' } }),
      options('2026-11-04'),
    );
    const after = scheduleRun(
      route,
      facts({
        '1': { status: 'in_progress', openedOn: '2026-11-02', expectedEnd: '2026-11-20' },
      }),
      options('2026-11-04'),
    );
    expect(after.steps['1']).toMatchObject({ forecastEnd: '2026-11-20', health: 'at_risk' });
    expect((after.forecastLaunch as string) > (before.forecastLaunch as string)).toBe(true);
    expect(after.steps['3']?.forecastStart).toBe('2026-11-20');
  });

  it('uses the length of the baseline plan, and is overdue by it', () => {
    const plan = planOfSteps([
      { stepKey: '7', plannedStart: '2026-11-02', plannedEnd: '2026-11-06' },
      { stepKey: '7', plannedStart: '2026-11-03', plannedEnd: '2026-11-13' },
    ]);
    expect(plan['7']).toEqual({ start: '2026-11-02', end: '2026-11-13' });
    const run = scheduleRun(
      route,
      facts({ '7': { status: 'in_progress', openedOn: '2026-11-02', plan: plan['7'] ?? null } }),
      options('2026-11-16'),
    );
    expect(run.steps['7']).toMatchObject({
      plannedEnd: '2026-11-13',
      health: 'overdue',
      daysLate: 1,
    });
  });

  it('shows no health for finished steps, and keeps their actual end', () => {
    const run = scheduleRun(
      route,
      facts({
        '1': { status: 'approved', openedOn: '2026-11-02', completedOn: '2026-11-05' },
      }),
      options('2026-11-20'),
    );
    expect(run.steps['1']).toMatchObject({ health: null, forecastEnd: '2026-11-05' });
  });

  it('starts waiting steps when their inputs are expected to end, never in the past', () => {
    const run = scheduleRun(
      route,
      facts({
        '1': { status: 'approved', openedOn: '2026-11-02', completedOn: '2026-11-04' },
        '2': { status: 'approved', openedOn: '2026-11-02', completedOn: '2026-11-04' },
      }),
      options('2026-11-10'),
    );
    expect(run.steps['3']?.forecastStart).toBe('2026-11-10');
  });
});

describe('project health', () => {
  const settings = SCHEDULE_DEFAULTS;
  const healthOf = (f: Record<StepKey, StepFacts>, today: string, plannedLaunch: string | null) => {
    const schedule = scheduleRun(route, f, options(today));
    return projectHealth(route, schedule, { plannedLaunch, settings });
  };

  it('is green when nothing is late or at risk', () => {
    const f = facts({ '1': { status: 'in_progress', openedOn: '2026-11-02' } });
    const launch = defaultLaunch(route, '2026-11-02', cal);
    expect(healthOf(f, '2026-11-03', launch).health).toBe('green');
  });

  it('is amber when a step is overdue', () => {
    const f = facts({ '1': { status: 'in_progress', openedOn: '2026-11-02' } });
    const launch = defaultLaunch(route, '2026-11-02', cal);
    const result = healthOf(f, '2026-11-10', launch);
    expect(result.health).toBe('amber');
    expect(result.reasons).toContainEqual({ code: 'step_overdue', step: '1', days: 1 });
  });

  it('is red when a checkpoint is overdue', () => {
    const f = facts({
      '4': { status: 'in_review', openedOn: '2026-11-02', submittedOn: '2026-11-02' },
    });
    const result = healthOf(f, '2026-11-12', null);
    expect(result.health).toBe('red');
    expect(result.reasons).toContainEqual({ code: 'checkpoint_overdue', step: '4' });
  });

  it('is red when a step is more than 10 working days overdue', () => {
    const f = facts({ '1': { status: 'in_progress', openedOn: '2026-11-02' } });
    expect(healthOf(f, '2026-11-23', null).health).toBe('amber');
    expect(healthOf(f, '2026-11-24', null).health).toBe('red');
  });

  it('is red when the forecast launch is more than 30 days past plan', () => {
    const f = facts({
      '1': { status: 'in_progress', openedOn: '2026-11-02', expectedEnd: '2027-02-01' },
    });
    const planned = defaultLaunch(route, '2026-11-02', cal) as string;
    const result = healthOf(f, '2026-11-04', planned);
    expect(result.health).toBe('red');
    expect(result.reasons.some((r) => r.code === 'launch_slipped')).toBe(true);
  });
});
