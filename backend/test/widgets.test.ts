import { addWorkingDays, dateOfInstant, makeCalendar, WIDGETS } from '@coal/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OutboxDispatcher } from '../src/modules/events/dispatcher';
import { SUBSCRIPTIONS } from '../src/modules/events/subscriptions';
import { createTestApp, type TestApp } from './helpers';
import { createWorld, type World } from './world';

let t: TestApp;
let w: World;
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
const widget = (key: string, as: string, query = '') =>
  ok(call('GET', `/widgets/${key}?view=${query.includes('view=') ? '' : 'compact'}${query}`, as));
const expanded = (key: string, as: string, query = '') =>
  ok(call('GET', `/widgets/${key}?view=expanded${query}`, as));
const countOf = (data: any, key: string) => data.counts.find((c: any) => c.key === key)?.value;
const drain = () => new OutboxDispatcher(t.deps.db, SUBSCRIPTIONS).drain();
const cal = makeCalendar();
const today = () => dateOfInstant(clock());
const fresh = (name: string) => `${name} ${Math.random().toString(36).slice(2, 7)}`;
const rowsOf = (data: any) => data.rows as any[];

describe('the widget list', () => {
  it('gives each role its own layout, from the plan', async () => {
    const layout = async (as: string) => (await ok(call('GET', '/widgets', as))).layout;
    expect(await layout('vp')).toEqual([
      'waiting-signature',
      'my-tasks',
      'pipeline',
      'delays-risks',
      'upcoming-checkpoints',
      'team-workload',
      'how-its-going',
      'messages',
    ]);
    expect(await layout('md')).toEqual([
      'waiting-signature',
      'pipeline',
      'delays-risks',
      'upcoming-checkpoints',
      'how-its-going',
    ]);
    expect(await layout('lead')).toContain('team-workload');
    expect(await layout('designer')).toEqual([
      'my-tasks',
      'waiting-signature',
      'coming-up',
      'my-projects',
      'messages',
      'how-its-going',
    ]);
    expect(await layout('outsider')).toEqual(['my-tasks', 'waiting-signature', 'messages']);
  });

  it('lists the widgets with their tabs, filters and columns', async () => {
    const { widgets } = await ok(call('GET', '/widgets', 'vp'));
    expect(widgets.map((x: any) => x.no)).toEqual(WIDGETS.map((x) => x.no));
    const delays = widgets.find((x: any) => x.key === 'delays-risks');
    expect(delays.tabs).toEqual(['delays', 'deviations']);
    // Team workload is for people with people below them.
    const designer = (await ok(call('GET', '/widgets', 'designer'))).widgets.map((x: any) => x.key);
    expect(designer).not.toContain('team-workload');
  });

  it('needs a session, and refuses a widget the role may not use, naming who can', async () => {
    expect((await call('GET', '/widgets', null)).status).toBe(401);
    expect((await call('GET', '/widgets/my-tasks', null)).status).toBe(401);
    const refused = await call('GET', '/widgets/team-workload', 'designer');
    expect(refused.status).toBe(403);
    expect(refused.body.whoCan).toEqual(['VP', 'R&D Head', 'R&D Lead']);
    expect((await call('GET', '/widgets/nope', 'vp')).status).toBe(400);
  });
});

describe('what needs me now', () => {
  it('shows my tasks, what is overdue, and only mine', async () => {
    daysAhead = 0;
    const id = await w.go(fresh('Tasks widget'));
    const compact = await widget('my-tasks', 'ops');
    expect(compact.view).toBe('compact');
    expect(rowsOf(compact).length).toBeLessThanOrEqual(5);
    expect(countOf(compact, 'overdue')).toBe(0);
    const row = rowsOf(compact).find((r) => r.ref.projectId === id && r.cells.step === '2');
    expect(row).toMatchObject({
      title: 'Work on step 2: Market study',
      link: `/projects/${id}?step=2`,
      cells: { step: '2', kind: 'work', status: 'open' },
      // A step's task follows its step: it is started and handed in from the step.
      actions: ['more_time', 'open'],
    });
    // Someone else's tasks aren't mine.
    const designer = await expanded('my-tasks', 'designer');
    expect(rowsOf(designer).some((r) => r.ref.projectId === id)).toBe(false);

    daysAhead = 40;
    const late = await expanded('my-tasks', 'ops');
    expect(countOf(late, 'overdue')).toBeGreaterThan(0);
    const lateRow = rowsOf(late).find((r) => r.ref.projectId === id && r.cells.step === '2');
    expect(lateRow.tone).toBe('danger');
    expect(lateRow.badges[0].label).toMatch(/d late$/);
    const overdueOnly = await expanded('my-tasks', 'ops', '&filter[due]=overdue');
    expect(rowsOf(overdueOnly).every((r) => r.cells.due < today())).toBe(true);
    const later = await expanded('my-tasks', 'ops', '&filter[due]=later');
    expect(rowsOf(later)).toHaveLength(0);
    daysAhead = 0;
  });

  it('moves a task between tabs as it is worked, and lists what is done', async () => {
    daysAhead = 0;
    const id = await w.go(fresh('Tabs'));
    const task = (await w.stepOf(id, '2')).tasks[0];
    // The step moves its tasks: starting the step starts the task, and the task can't be started by hand.
    expect(
      (await call('PATCH', `/tasks/${task.id}`, 'ops', { status: 'in_progress' })).body.code,
    ).toBe('USE_THE_STEP');
    await ok(call('POST', `/projects/${id}/steps/2/start`, 'ops'));
    const inProgress = await expanded('my-tasks', 'ops', '&tab=in_progress');
    expect(rowsOf(inProgress).some((r) => r.id === task.id)).toBe(true);
    expect(inProgress.tab).toBe('in_progress');
    expect(rowsOf(inProgress).find((r) => r.id === task.id).actions).toEqual(['more_time', 'open']);
    // Closed when the step is signed off.
    await w.finish(id, '2');
    const done = await expanded('my-tasks', 'ops', '&tab=done');
    expect(rowsOf(done).some((r) => r.id === task.id)).toBe(true);
    expect(
      rowsOf(await expanded('my-tasks', 'ops', '&tab=todo')).some((r) => r.id === task.id),
    ).toBe(false);
  });

  it('keeps the doers’ tasks waiting while the step is with its signer, and not late', async () => {
    daysAhead = 0;
    const id = await w.go(fresh('Waiting'));
    await w.attach(id, '2');
    const task = (await w.stepOf(id, '2')).tasks[0];
    await ok(call('POST', `/projects/${id}/steps/2/submit`, 'ops'));
    expect((await w.stepOf(id, '2')).tasks.find((x: any) => x.id === task.id).status).toBe(
      'waiting',
    );
    const waiting = await expanded('my-tasks', 'ops', '&tab=waiting');
    // It says who has it, not the doer's own date, and the doer may remind them.
    expect(rowsOf(waiting).find((r) => r.id === task.id)).toMatchObject({
      tone: 'neutral',
      badges: [{ label: 'With the VP', tone: 'neutral' }],
      cells: { due: null, waitingOn: 'Vera Example', status: 'waiting' },
      actions: ['remind', 'open'],
    });
    expect(
      rowsOf(await expanded('my-tasks', 'ops', '&tab=todo')).some((r) => r.id === task.id),
    ).toBe(false);

    // Weeks later the signature is late, not the doers' work: the row shows whose lateness it is.
    daysAhead = 40;
    const late = await expanded('my-tasks', 'ops', '&tab=waiting');
    const lateRow = rowsOf(late).find((r) => r.id === task.id);
    expect(lateRow.tone).toBe('warning');
    expect(lateRow.badges).toEqual([
      { label: expect.stringMatching(/^VP \d+d late$/), tone: 'warning' },
    ]);
    const overdue = await expanded('my-tasks', 'ops', '&tab=waiting&filter[due]=overdue');
    expect(rowsOf(overdue).some((r) => r.id === task.id)).toBe(false);
    const asTask = await ok(call('GET', `/tasks/${task.id}`, 'ops'));
    expect(asTask).toMatchObject({ status: 'waiting', daysLate: 0 });
    expect(asTask.waitingOn.daysLate).toBeGreaterThan(0);
    // The late step is the signer's to finish, so Delays names them as its owner.
    const delay = rowsOf(await expanded('delays-risks', 'vp', `&filter[project]=${id}`)).find(
      (r) => r.ref.stepKey === '2',
    );
    expect(delay.cells.owner).toBe('VP sign-off: Vera Example');
    daysAhead = 0;

    // A return puts the work back in the doers' hands.
    await ok(call('POST', `/projects/${id}/steps/2/return`, 'vp', { comment: 'Again, please.' }));
    expect((await w.stepOf(id, '2')).tasks.find((x: any) => x.id === task.id).status).toBe('open');
  });

  it('lists what waits for my signature, oldest first', async () => {
    const id = await w.go(fresh('Signatures widget'));
    await w.attach(id, '2');
    await ok(call('POST', `/projects/${id}/steps/2/submit`, 'ops'));
    const compact = await widget('waiting-signature', 'vp');
    const row = rowsOf(compact)
      .concat(rowsOf(await expanded('waiting-signature', 'vp')))
      .find((r) => r.ref.projectId === id);
    expect(row).toMatchObject({
      title: 'Sign off step 2: Market study',
      cells: { what: 'Step sign-off', row: 'approved' },
      actions: ['open'],
    });
    expect(countOf(compact, 'waiting')).toBeGreaterThan(0);
    // Nobody else is asked.
    expect(
      rowsOf(await expanded('waiting-signature', 'ops')).some((r) => r.ref.projectId === id),
    ).toBe(false);
  });
});

describe("what's coming", () => {
  it('lists the steps of mine that will open, and what each waits for', async () => {
    const id = await w.go(fresh('Coming'));
    const designer = rowsOf(await expanded('coming-up', 'designer')).filter(
      (r) => r.ref.projectId === id,
    );
    expect(designer.map((r) => r.cells.step)).toEqual(expect.arrayContaining(['7', '8']));
    expect(designer.find((r) => r.cells.step === '7').cells.waitsFor).toMatch(
      /^Your part starts after step 5, expected \d{4}-/,
    );
    // Steps that are mine to do, and no others.
    expect(designer.every((r) => ['7', '8', '13', '12', '24a', '24b'].includes(r.cells.step))).toBe(
      true,
    );
    // Someone off the project, and outside R&D, has nothing coming.
    expect(
      rowsOf(await expanded('coming-up', 'outsider')).some((r) => r.ref.projectId === id),
    ).toBe(false);
  });

  it('shows the next checkpoint of every running project to everyone, with whether its inputs are ready', async () => {
    const id = await w.go(fresh('Checkpoints'));
    for (const as of ['outsider', 'qa', 'md', 'designer']) {
      const row = rowsOf(await expanded('upcoming-checkpoints', as)).find(
        (r) => r.ref.projectId === id,
      );
      expect(row, as).toMatchObject({
        title: 'Step 4: Board approval',
        cells: { step: '4', signer: 'Board', inputs: 'Waiting on step 3' },
      });
    }
    await w.advance(id, '3');
    const ready = rowsOf(await expanded('upcoming-checkpoints', 'vp')).find(
      (r) => r.ref.projectId === id,
    );
    expect(ready.cells.inputs).toBe('Ready');
    await w.advance(id, '4', { from: '4' });
    const next = rowsOf(await expanded('upcoming-checkpoints', 'vp')).find(
      (r) => r.ref.projectId === id,
    );
    expect(next.cells.step).toBe('12');
  });
});

describe('how we are doing', () => {
  it('shows my projects, and every project in the pipeline', async () => {
    const id = await w.go(fresh('Pipeline'));
    const mine = async (as: string) =>
      rowsOf(await expanded('my-projects', as)).map((r) => r.ref.projectId);
    expect(await mine('designer')).toContain(id);
    expect(await mine('lead')).toContain(id);
    expect(await mine('leadOther')).not.toContain(id);
    expect(await mine('outsider')).not.toContain(id);

    const all = await expanded('pipeline', 'outsider');
    const row = rowsOf(all).find((r) => r.ref.projectId === id);
    expect(row).toMatchObject({
      cells: { line: 'SPN', stage: 1, health: 'green', lead: 'Leela Example' },
      tone: 'good',
    });
    expect(row.cells.steps).toContain('1');
    expect(countOf(await widget('pipeline', 'vp'), 'stage1')).toBeGreaterThan(0);

    expect(
      rowsOf(await expanded('pipeline', 'vp', '&filter[line]=TRM')).some(
        (r) => r.ref.projectId === id,
      ),
    ).toBe(false);
    expect(
      rowsOf(await expanded('pipeline', 'vp', '&filter[line]=SPN')).some(
        (r) => r.ref.projectId === id,
      ),
    ).toBe(true);
    expect(
      rowsOf(await expanded('pipeline', 'vp', '&filter[stage]=2')).some(
        (r) => r.ref.projectId === id,
      ),
    ).toBe(false);
    expect(
      rowsOf(await expanded('pipeline', 'vp', '&filter[health]=red')).some(
        (r) => r.ref.projectId === id,
      ),
    ).toBe(false);
  });

  it('shows delays with the reason and cause, and the named cause only to those allowed', async () => {
    daysAhead = 0;
    const id = await w.go(fresh('Delays'));
    const task = (await w.stepOf(id, '2')).tasks[0];
    daysAhead = 40;
    const date = addWorkingDays(cal, today(), 3);
    await ok(
      call('POST', '/deviations', 'ops', {
        taskId: task.id,
        reasonCode: 'test_lab_delay',
        reasonText: 'The lab is booked until next week.',
        causeType: 'person',
        causeUserId: w.who.dard!.user.id,
        newDate: date,
      }),
    );
    await ok(
      call('POST', `/deviations`, 'lead', {
        taskId: task.id,
        reasonCode: 'other',
        reasonText: 'Second.',
        causeType: 'role',
        causeRole: 'marketing',
        newDate: date,
      }),
    );

    const delay = async (as: string) =>
      rowsOf(await expanded('delays-risks', as)).find(
        (r) => r.ref.projectId === id && r.cells.step === '2',
      );
    const vp = await delay('vp');
    expect(vp.cells).toMatchObject({ step: '2', reason: 'other', cause: 'Marketing' });
    expect(vp.cells.daysLate).toBeGreaterThan(0);
    expect(vp.cells.owner).toContain('Om Example');
    expect(vp.tone).toBe('danger');
    expect((await widget('delays-risks', 'outsider')).counts.length).toBe(3);

    // The deviations tab: the first one names a person.
    const named = async (as: string) =>
      rowsOf(await expanded('delays-risks', as, '&tab=deviations')).filter(
        (r) => r.ref.projectId === id,
      );
    const forVp = await named('vp');
    expect(forVp.map((r) => r.cells.cause).sort()).toEqual(['Dina Example', 'Marketing']);
    const forPme = await named('pme');
    expect(forPme.map((r) => r.cells.cause).sort()).toEqual(['DARD', 'Marketing']);
    // The sentence is content: not shown to someone outside the project.
    const forOutsider = await named('outsider');
    expect(forOutsider.every((r) => r.subtitle === null)).toBe(true);
    expect(forVp.some((r) => r.subtitle === 'The lab is booked until next week.')).toBe(true);
    // Something waits for the Lead to review.
    expect(countOf(await widget('delays-risks', 'lead'), 'toReview')).toBeGreaterThan(0);
    expect(countOf(await widget('delays-risks', 'ops'), 'toReview')).toBe(0);
    daysAhead = 0;
  });

  it('shows the workload of the people below me, to those who have people below them', async () => {
    daysAhead = 0;
    const id = await w.go(fresh('Workload'));
    const vp = await expanded('team-workload', 'vp');
    const names = rowsOf(vp).map((r) => r.title);
    expect(names).toEqual(expect.arrayContaining(['Om Example', 'Leela Example', 'Dev Example']));
    // Nobody above me, and nobody equal to me.
    expect(names).not.toContain('Vera Example');
    expect(names).not.toContain('Mira Example');
    const ops = rowsOf(vp).find((r) => r.title === 'Om Example');
    expect(ops.cells).toMatchObject({ role: 'R&D Ops' });
    expect(ops.cells.open).toBeGreaterThan(0);
    expect(ops.actions).toEqual(['reassign']);

    // A Lead sees the people on their product line's projects, below them.
    const lead = rowsOf(await expanded('team-workload', 'lead')).map((r) => r.title);
    expect(lead).toContain('Om Example');
    expect(lead).not.toContain('Hari Example');
    expect(rowsOf(await expanded('team-workload', 'leadOther'))).toHaveLength(0);
    const filtered = await expanded('team-workload', 'vp', `&filter[project]=${id}`);
    expect(rowsOf(filtered).find((r) => r.title === 'Om Example').cells.open).toBeGreaterThan(0);

    // Late work shows in the overdue column.
    daysAhead = 40;
    expect(
      rowsOf(await expanded('team-workload', 'vp')).find((r) => r.title === 'Om Example').cells
        .overdue,
    ).toBeGreaterThan(0);
    daysAhead = 0;
  });

  it('does not count the signer’s wait against the person who handed the work in', async () => {
    daysAhead = 0;
    const id = await w.go(fresh('Signer wait'));
    await w.attach(id, '2');
    await ok(call('POST', `/projects/${id}/steps/2/submit`, 'ops'));
    // The VP signs weeks later: the work was handed in on time.
    daysAhead = 40;
    await ok(call('POST', `/projects/${id}/steps/2/approve`, 'vp'));
    daysAhead = 0;
    const row = rowsOf(await expanded('how-its-going', 'ops'))[0];
    expect(row.cells.onTime).toBe(100);
    // The wait shows as the signer's turnaround.
    const vp = rowsOf(await expanded('how-its-going', 'vp'))[0];
    expect(vp.cells.signTurnaround).toBeGreaterThan(3);
  });

  it('shows my measures, and my team’s; the Board sees department totals', async () => {
    daysAhead = 0;
    const id = await w.go(fresh('Measures'));
    await w.finish(id, '2');

    const own = await expanded('how-its-going', 'ops');
    expect(rowsOf(own)).toHaveLength(1);
    expect(rowsOf(own)[0]).toMatchObject({ id: w.who.ops!.user.id, badges: [{ label: 'You' }] });
    expect(rowsOf(own)[0].cells.onTime).toBe(100);
    expect(countOf(own, 'myOnTime')).toBe(100);
    expect(own.counts.find((c: any) => c.key === 'teamOnTime')).toBeUndefined();

    const lead = await expanded('how-its-going', 'lead');
    const people = rowsOf(lead).map((r) => r.title);
    expect(people[0]).toBe('Leela Example');
    expect(people).toContain('Om Example');
    expect(people).not.toContain('Hari Example');
    expect(lead.counts.find((c: any) => c.key === 'teamOnTime')).toBeTruthy();

    const board = await expanded('how-its-going', 'md');
    expect(rowsOf(board).map((r) => r.title)).toEqual(['Department totals']);
    expect(countOf(board, 'departmentOnTime')).toBeGreaterThanOrEqual(0);

    // A person with no finished work yet has nothing to measure.
    const designer = rowsOf(await expanded('how-its-going', 'designer'))[0];
    expect(designer.cells.onTime).toBeNull();
    expect(designer.cells.rework).toBeNull();
  });

  it('counts a late task against the on-time rate, even after its date is moved', async () => {
    daysAhead = 0;
    const id = await w.go(fresh('Late measure'));
    const task = (await w.stepOf(id, '2')).tasks[0];
    daysAhead = 40;
    await ok(
      call('POST', '/deviations', 'ops', {
        taskId: task.id,
        reasonCode: 'other',
        reasonText: 'Delayed.',
        causeType: 'role',
        causeRole: 'marketing',
        newDate: today(),
      }),
    );
    // Handed in late, and signed off: the work counts as done, late against its first date.
    await w.finish(id, '2');
    const row = rowsOf(await expanded('how-its-going', 'ops'))[0];
    // Moving the date doesn't improve the rate: at least one late task is counted.
    expect(row.cells.onTime).toBeLessThan(100);
    daysAhead = 0;
  });

  it('shows my messages, and which are new', async () => {
    await w.go(fresh('Messages widget'));
    await drain();
    const compact = await widget('messages', 'ops');
    expect(countOf(compact, 'unread')).toBeGreaterThan(0);
    const top = rowsOf(compact)[0];
    expect(top).toMatchObject({ badges: [{ label: 'New' }], actions: ['mark_read', 'open'] });
    await ok(call('POST', `/notifications/${top.ref.notificationId}/read`, 'ops'));
    const unread = await expanded('messages', 'ops', '&tab=unread');
    expect(rowsOf(unread).some((r) => r.id === top.id)).toBe(false);
    expect(unread.tab).toBe('unread');
  });
});

describe('what each person may see', () => {
  it('never shows a widget row of someone else’s tasks, or a project the person has no part in, where that is content', async () => {
    const id = await w.go(fresh('Visibility'));
    // Status is open to everyone: the pipeline and checkpoints list the project...
    expect(rowsOf(await expanded('pipeline', 'outsider')).some((r) => r.ref.projectId === id)).toBe(
      true,
    );
    // ...but tasks, signatures and "my" lists are the person's own.
    for (const key of ['my-tasks', 'waiting-signature', 'coming-up', 'my-projects'] as const) {
      const data = await expanded(key, 'outsider');
      expect(
        rowsOf(data).some((r) => r.ref.projectId === id),
        key,
      ).toBe(false);
    }
  });
});
