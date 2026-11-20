import { addWorkingDays, dateOfInstant, makeCalendar } from '@coal/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_ORG_ID } from '../src/core/config';
import { recomputeAll } from '../src/modules/schedule/nightly';
import { timelineItems, settings, workCalendar } from '../src/modules/schedule/tables';
import { createTestApp, type TestApp } from './helpers';
import { createWorld, type World } from './world';

let t: TestApp;
let w: World;

/** The test clock: real time, moved forward by whole days when a test needs lateness. */
let daysAhead = 0;
const clock = () => new Date(Date.now() + daysAhead * 86_400_000);

beforeAll(async () => {
  t = await createTestApp();
  t.deps.now = clock;
  w = await createWorld(t);
});
afterAll(async () => {
  await t?.close();
});

const call = (...args: Parameters<World['call']>) => w.call(...args);
const ok = (res: Promise<{ status: number; body: any }>) => w.ok(res);
const cal = makeCalendar();
const today = () => dateOfInstant(clock());
const travel = (days: number) => {
  daysAhead = days;
};

const timeline = (id: string, as = 'vp') => ok(call('GET', `/projects/${id}/timeline`, as));
const step = (tl: any, key: string) => tl.steps.find((s: any) => s.key === key);

describe('dates from the route', () => {
  it('gives each task a due date from its step, and a planned and forecast launch', async () => {
    travel(0);
    const id = await w.go('Dates at Go');
    const tl = await timeline(id);
    // Step 1 has 5 default working days from today.
    expect(step(tl, '1')).toMatchObject({
      status: 'ready',
      plannedStart: today(),
      plannedEnd: addWorkingDays(cal, today(), 5),
      health: 'ok',
      daysLate: 0,
    });
    expect(tl.plannedLaunch).toBeTruthy();
    expect(tl.forecastLaunch).toBe(tl.plannedLaunch);
    expect(tl.health).toBe('green');
    expect(tl.baselineNo).toBe(0);

    const tasks = (await ok(call('GET', '/tasks?limit=100', 'lead'))).items.filter(
      (task: any) => task.subject?.id === id,
    );
    expect(tasks.length).toBeGreaterThan(0);
    for (const task of tasks) {
      expect(task.dueOn).toBe(addWorkingDays(cal, today(), 5));
      expect(task.daysLate).toBe(0);
    }
  });

  it('shows the dates and health on the route, and on the project', async () => {
    travel(0);
    const id = await w.go('Dates on the route');
    const s1 = await w.stepOf(id, '1');
    expect(s1).toMatchObject({ plannedEnd: addWorkingDays(cal, today(), 5), health: 'ok' });
    const project = await ok(call('GET', `/projects/${id}`, 'vp'));
    expect(project).toMatchObject({ health: 'green', plannedLaunch: expect.any(String) });
  });
});

describe('when work is late', () => {
  it('turns a step overdue, asks for a reason before submitting, and moves the forecast', async () => {
    travel(0);
    const id = await w.go('Late step');
    const before = await timeline(id);

    travel(20);
    const late = await timeline(id);
    expect(step(late, '1')).toMatchObject({ health: 'overdue', needsDeviation: true });
    expect(step(late, '1').daysLate).toBeGreaterThan(5);

    // The nightly job works every running project's health out again.
    expect(await recomputeAll(t.deps, DEFAULT_ORG_ID)).toBeGreaterThan(0);
    const after = await ok(call('GET', `/projects/${id}`, 'vp'));
    expect(['amber', 'red']).toContain(after.health);
    expect((await timeline(id)).forecastLaunch! > before.forecastLaunch!).toBe(true);

    // The doers can't hand it in until someone says why it is late.
    const blocked = await call('POST', `/projects/${id}/steps/1/submit`, 'head');
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('DEVIATION_REQUIRED');

    const taskId = (await w.stepOf(id, '1')).tasks.find((x: any) => x.kind === 'work').id;
    const recorded = await ok(
      call('POST', '/deviations', 'head', {
        taskId,
        reasonCode: 'vendor_delay',
        reasonText: 'The vendor sent the drawings late.',
        causeType: 'outside',
        causeParty: 'A made-up vendor',
        newDate: addWorkingDays(cal, today(), 3),
      }),
    );
    expect(recorded.kind).toBe('late');
    await ok(call('POST', `/projects/${id}/steps/1/submit`, 'head'));
    travel(0);
  });

  it('refuses to hand in a late step until its deviation is recorded', async () => {
    travel(0);
    const id = await w.go('Late task');
    const task = (await w.stepOf(id, '2')).tasks[0];
    travel(30);
    // The step's task can't be closed by hand: handing in the step is how it closes.
    const byHand = await call('PATCH', `/tasks/${task.id}`, 'ops', { status: 'done' });
    expect(byHand.status).toBe(409);
    expect(byHand.body.code).toBe('USE_THE_STEP');
    const refused = await call('POST', `/projects/${id}/steps/2/submit`, 'ops');
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('DEVIATION_REQUIRED');
    await ok(
      call('POST', '/deviations', 'ops', {
        taskId: task.id,
        reasonCode: 'other',
        reasonText: 'Waiting for a survey result.',
        causeType: 'role',
        causeRole: 'marketing',
        newDate: today(),
      }),
    );
    await ok(call('POST', `/projects/${id}/steps/2/submit`, 'ops'));
    // Handed in: the task waits for the signer, and closes when the step is signed off.
    expect((await w.stepOf(id, '2')).tasks.find((x: any) => x.id === task.id).status).toBe(
      'waiting',
    );
    travel(0);
  });

  it('asks again when the new date is missed too, and when a step is late again', async () => {
    travel(0);
    const id = await w.go('Late twice');
    const task = (await w.stepOf(id, '2')).tasks[0];
    const explain = (newDate: string) =>
      call('POST', '/deviations', 'ops', {
        taskId: task.id,
        reasonCode: 'other',
        reasonText: 'Still waiting.',
        causeType: 'role',
        causeRole: 'marketing',
        newDate,
      });

    travel(30);
    await ok(explain(addWorkingDays(cal, today(), 3)));
    // Within the new date: no new reason is needed to hand the step in.
    expect((await w.stepOf(id, '2')).tasks[0].dueOn).toBe(addWorkingDays(cal, today(), 3));

    // The new date passes too.
    travel(60);
    const step = await call('POST', `/projects/${id}/steps/2/submit`, 'ops');
    expect(step.status).toBe(409);
    expect(step.body.code).toBe('DEVIATION_REQUIRED');

    await ok(explain(addWorkingDays(cal, today(), 2)));
    await ok(call('POST', `/projects/${id}/steps/2/submit`, 'ops'));
    travel(0);
  });

  it('takes the latest date of the open work for the step, whoever recorded last', async () => {
    travel(0);
    const id = await w.go('Two tasks');
    const all = (await w.stepOf(id, '1')).tasks.filter((x: any) => x.kind === 'work');
    expect(all.length).toBe(2);
    // The Lead's own task, and the Head's (waiting in the Head queue).
    const tasks = [all.find((x: any) => x.assignee), all.find((x: any) => !x.assignee)];
    const far = addWorkingDays(cal, today(), 20);
    const near = addWorkingDays(cal, today(), 10);
    const record = (taskId: string, newDate: string) =>
      ok(
        call('POST', '/deviations', 'head', {
          taskId,
          reasonCode: 'other',
          reasonText: 'More time.',
          causeType: 'role',
          causeRole: 'marketing',
          newDate,
        }),
      );
    await record(tasks[0].id, far);
    await record(tasks[1].id, near);
    // The later date holds, though the earlier one was recorded last.
    expect(step(await timeline(id), '1').forecastEnd).toBe(far);

    // Once the step is handed in, no task holds the forecast back: the signer's window does.
    await ok(call('POST', `/projects/${id}/steps/1/submit`, 'head'));
    expect(step(await timeline(id), '1').forecastEnd).toBe(addWorkingDays(cal, today(), 3));
  });

  it('is judged by the signer’s wait, not the doers’, once a step is handed in', async () => {
    travel(0);
    const id = await w.go('Handed in');
    await ok(call('POST', `/projects/${id}/steps/2/submit`, 'ops'));
    const waited = await timeline(id);
    expect(step(waited, '2').health).toBe('ok');
    travel(0);
  });
});

describe('the working calendar and the settings', () => {
  it('skips holidays when it counts working days', async () => {
    travel(0);
    const holiday = addWorkingDays(cal, today(), 2);
    await t.deps.db.insert(workCalendar).values({
      orgId: DEFAULT_ORG_ID,
      date: holiday,
      isWorkingDay: false,
      note: 'A test holiday',
    });
    try {
      const id = await w.go('Holiday');
      const withHoliday = makeCalendar([{ date: holiday, isWorkingDay: false }]);
      const expected = addWorkingDays(withHoliday, today(), 5);
      expect(expected).not.toBe(addWorkingDays(cal, today(), 5));
      expect(step(await timeline(id), '1').plannedEnd).toBe(expected);
    } finally {
      await t.deps.db.delete(workCalendar).where(eq(workCalendar.date, holiday));
    }
  });

  it('reads the thresholds from the settings, not from code', async () => {
    travel(0);
    const id = await w.go('Thresholds');
    expect(step(await timeline(id), '1').health).toBe('ok');
    await t.deps.db
      .insert(settings)
      .values({ orgId: DEFAULT_ORG_ID, key: 'schedule', value: { atRiskWorkingDays: 5 } });
    try {
      // Due in 5 working days and not started: now at risk, as the settings say.
      expect(await recomputeAll(t.deps, DEFAULT_ORG_ID)).toBeGreaterThan(0);
      expect(step(await timeline(id), '1').health).toBe('at_risk');
      expect((await ok(call('GET', `/projects/${id}`, 'vp'))).health).toBe('amber');
    } finally {
      await t.deps.db.delete(settings).where(eq(settings.key, 'schedule'));
    }
  });
});

describe('the Action Plan sets the baseline', () => {
  it('turns the written plan into the baseline when the VP signs, and gives later tasks its dates', async () => {
    travel(0);
    const id = await w.go('Baseline');
    await w.advance(id, '4');

    // Only the people who do step 5 can write the plan.
    const item = {
      stepKey: '6',
      roleKey: 'rd_ops',
      plannedStart: today(),
      plannedEnd: '2027-01-15',
    };
    expect(
      (await call('PUT', `/projects/${id}/timeline/plan`, 'pme', { items: [item] })).status,
    ).toBe(403);
    const bad = await call('PUT', `/projects/${id}/timeline/plan`, 'lead', {
      items: [{ ...item, stepKey: '1' }],
    });
    expect(bad.status).toBe(400);
    const wrongRole = await call('PUT', `/projects/${id}/timeline/plan`, 'lead', {
      items: [{ ...item, roleKey: 'qc_inspector' }],
    });
    expect(wrongRole.status).toBe(400);

    const draft = await ok(
      call('PUT', `/projects/${id}/timeline/plan`, 'lead', {
        items: [
          item,
          { stepKey: '6', roleKey: 'dard', plannedStart: today(), plannedEnd: '2027-01-10' },
          { stepKey: '25', roleKey: 'vp', plannedStart: '2027-09-01', plannedEnd: '2027-09-10' },
        ],
      }),
    );
    expect(draft.draft).toHaveLength(3);
    expect(draft.baselineNo).toBe(0);
    expect(draft.can.editPlan).toBe(true);

    // Submitting a plan with no dates warns; this one has some.
    const preview = await ok(call('POST', `/projects/${id}/steps/5/submit?preview=true`, 'lead'));
    expect(preview.preview.warnings.join(' ')).not.toContain('No dates are written');

    await w.finish(id, '5');
    const tl = await timeline(id);
    expect(tl.baselineNo).toBe(1);
    expect(tl.draft).toHaveLength(0);
    expect(tl.items.filter((i: any) => i.kind === 'baseline')).toHaveLength(3);
    expect(tl.plannedLaunch).toBe('2027-09-10');
    expect(step(tl, '6')).toMatchObject({ plannedEnd: '2027-01-15', plannedStart: today() });

    // The tasks of step 6 are due on each role's own date.
    const tasks = (await w.stepOf(id, '6')).tasks as { dueOn: string; title: string }[];
    expect(tasks.map((x) => x.dueOn).sort()).toEqual(['2027-01-10', '2027-01-15', '2027-01-15']);

    // A signed baseline can't be edited in the database.
    await expect(
      t.deps.db
        .update(timelineItems)
        .set({ plannedEnd: '2030-01-01' })
        .where(eq(timelineItems.kind, 'baseline')),
    ).rejects.toThrow();
  });

  it('warns when step 5 is submitted with no dates written', async () => {
    const id = await w.go('No plan');
    await w.advance(id, '4');
    const preview = await ok(call('POST', `/projects/${id}/steps/5/submit?preview=true`, 'lead'));
    expect(preview.preview.warnings.join(' ')).toContain('No dates are written');
    // Writing a plan is only allowed while step 5 is open.
    await w.finish(id, '5');
    const late = await call('PUT', `/projects/${id}/timeline/plan`, 'lead', { items: [] });
    expect(late.status).toBe(409);
  });

  it('lets the Head change a date, and only the VP change the launch', async () => {
    const id = await w.go('Changes');
    await w.advance(id, '4');
    await ok(
      call('PUT', `/projects/${id}/timeline/plan`, 'lead', {
        items: [
          { stepKey: '6', roleKey: 'rd_ops', plannedStart: today(), plannedEnd: '2027-01-15' },
          { stepKey: '25', roleKey: 'vp', plannedStart: '2027-09-01', plannedEnd: '2027-09-10' },
        ],
      }),
    );
    // No baseline yet: dates are written in the plan, not changed.
    const early = await call('POST', `/projects/${id}/timeline/changes`, 'head', {
      stepKey: '6',
      roleKey: 'rd_ops',
      plannedStart: today(),
      plannedEnd: '2027-01-20',
      reason: 'The vendor needs longer.',
    });
    expect(early.status).toBe(409);
    await w.finish(id, '5');

    const change = {
      stepKey: '6',
      roleKey: 'rd_ops',
      plannedStart: today(),
      plannedEnd: '2027-01-20',
      reason: 'The vendor needs longer.',
    };
    expect((await call('POST', `/projects/${id}/timeline/changes`, 'lead', change)).status).toBe(
      403,
    );
    expect(
      (await call('POST', `/projects/${id}/timeline/changes`, 'head', { ...change, reason: '' }))
        .status,
    ).toBe(400);
    const changed = await ok(call('POST', `/projects/${id}/timeline/changes`, 'head', change));
    expect(step(changed, '6').plannedEnd).toBe('2027-01-20');
    expect(changed.baselineNo).toBe(1);
    // The baseline is kept: the change is a new row beside it.
    expect(changed.items.map((i: any) => i.kind)).toContain('baseline');
    expect(changed.items.filter((i: any) => i.kind === 'change')).toHaveLength(1);
    // The reason for a change is content: the project's people read it, status viewers don't.
    const reasonFor = async (as: string) =>
      (await timeline(id, as)).items.find((i: any) => i.kind === 'change').reason;
    expect(await reasonFor('pme')).toBe('The vendor needs longer.');
    expect(await reasonFor('outsider')).toBeNull();
    expect((await timeline(id, 'outsider')).steps.find((s: any) => s.key === '6').plannedEnd).toBe(
      '2027-01-20',
    );

    // The open task for that role follows the new date; its first due date stays.
    const task = (await w.stepOf(id, '6')).tasks.find((x: any) => x.title.includes('Work on'));
    expect(task).toBeTruthy();

    const launch = {
      stepKey: '25',
      roleKey: 'vp',
      plannedStart: '2027-09-01',
      plannedEnd: '2027-10-01',
      reason: 'A slip.',
    };
    const refused = await call('POST', `/projects/${id}/timeline/changes`, 'head', launch);
    expect(refused.status).toBe(403);
    expect(refused.body.whoCan).toEqual(['VP']);
    const moved = await ok(call('POST', `/projects/${id}/timeline/changes`, 'vp', launch));
    expect(moved.plannedLaunch).toBe('2027-10-01');
    expect(moved.can).toMatchObject({ change: true, changeLaunch: true });
  });
});
